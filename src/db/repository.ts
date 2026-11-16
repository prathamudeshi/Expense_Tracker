/**
 * Every read and write against the local database lives here.
 *
 * The interesting part is `ingestRawMessage`, which is what turns a captured
 * notification or SMS into a transaction. It has to survive the fact that one
 * payment usually produces *two* messages (a GPay notification and a bank SMS),
 * and that the same message can be handed to us more than once (queue re-drain,
 * repeated SMS import). See the comments on the de-duplication steps below.
 */
import type {Scalar} from '@op-engineering/op-sqlite';
import {db} from './database';
import {
  classifyTransaction,
  matchesKeyword,
  UNCATEGORISED,
  type CategoryRule,
} from '../core/categorize';
import {parsePayment} from '../core/parser';
import {parseCsvRows, SEED_CSV} from '../core/seedData';
import {money} from '../core/money';
import type {
  AccountFilter,
  AnalystBrief,
  BankAccountSummary,
  CategoryTotal,
  Direction,
  HabitSpot,
  IgnoredMessage,
  IncomeBreakdown,
  InsightsDeepDive,
  InvestmentHolding,
  MerchantTotal,
  ModeFilter,
  MonthTotal,
  ParsedPayment,
  PaymentMode,
  PeerSplitItem,
  PeriodSummary,
  TicketTierStat,
  TimeSlotStat,
  Transaction,
  TxnSource,
} from '../core/types';
import {dayKey, DAY_MS, type Range} from '../core/dates';

type Row = Record<string, Scalar>;

/** A payment claimed by two different channels/apps within this window is one payment. */
const MERGE_WINDOW_MS = 10 * 60 * 1000;
const PHANTOM_WINDOW_MS = 3 * 60 * 1000;
const AUTOPAY_WINDOW_MS = 12 * 60 * 60 * 1000;
const IGNORED_LIMIT = 400;

export type IngestOutcome = 'inserted' | 'merged' | 'duplicate' | 'ignored';

export interface RawIngestInput {
  source: Exclude<TxnSource, 'manual'>;
  origin: string;
  title?: string;
  body: string;
  postedAt: number;
}

// ---------------------------------------------------------------------------
// coercion helpers - op-sqlite returns loosely typed scalars
// ---------------------------------------------------------------------------

function num(value: Scalar | undefined, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function str(value: Scalar | undefined, fallback = ''): string {
  return typeof value === 'string' ? value : value == null ? fallback : String(value);
}

function nstr(value: Scalar | undefined): string | null {
  if (value == null || value === '') {
    return null;
  }
  return typeof value === 'string' ? value : String(value);
}

function bool(value: Scalar | undefined): boolean {
  return num(value, 0) !== 0;
}

function toTransaction(row: Row): Transaction {
  return {
    id: num(row.id),
    amount: num(row.amount),
    direction: str(row.direction, 'DEBIT') as Direction,
    paymentMode: str(row.payment_mode, 'UPI') as PaymentMode,
    category: str(row.category, UNCATEGORISED),
    counterparty: nstr(row.counterparty),
    vpa: nstr(row.vpa),
    upiRef: nstr(row.upi_ref),
    accountTail: nstr(row.account_tail),
    instrument: nstr(row.instrument),
    occurredAt: num(row.occurred_at),
    createdAt: num(row.created_at),
    source: str(row.source, 'manual') as TxnSource,
    origin: nstr(row.origin),
    note: nstr(row.note),
    excluded: bool(row.excluded),
    categoryLocked: bool(row.category_locked),
    rawText: nstr(row.raw_text),
  };
}

/**
 * Cheap, stable string fingerprint (FNV-1a folded twice). Not cryptographic -
 * it only has to make accidental collisions between two different bank messages
 * vanishingly unlikely.
 */
function hashString(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < input.length; i += 1) {
    const code = input.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ code, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16)}${h2.toString(16)}${input.length.toString(16)}`;
}

function fingerprint(input: RawIngestInput): string {
  const body = `${input.title ?? ''} ${input.body}`.trim().toLowerCase().replace(/\s+/g, ' ');
  // 5 minute bucket: an app that re-posts the same notification a few times in
  // a row lands on one fingerprint. The postedAt of a given SMS never changes,
  // so re-importing the inbox produces identical fingerprints too.
  const bucket = Math.floor(input.postedAt / 300_000);
  return hashString(`${channelOf(input.source)}|${input.origin}|${body}|${bucket}`);
}

/** 'sms' and 'sms-import' are the same real-world channel. */
function channelOf(source: TxnSource): 'sms' | 'notification' | 'manual' {
  if (source === 'sms' || source === 'sms-import') {
    return 'sms';
  }
  return source === 'manual' ? 'manual' : 'notification';
}

function sourcesInChannel(source: TxnSource): [string, string] {
  return channelOf(source) === 'sms' ? ['sms', 'sms-import'] : ['notification', 'notification'];
}

// ---------------------------------------------------------------------------
// ingest
// ---------------------------------------------------------------------------

function isVerificationNoise(payment: ParsedPayment, rawText: string): boolean {
  if (payment.amount > 2) {
    return false;
  }
  const cp = (payment.counterparty ?? '').toLowerCase();
  const full = `${cp} ${rawText}`.toLowerCase();
  if (
    cp.includes('pratham') ||
    cp.includes('google workspac') ||
    full.includes('ax-icicit-s') ||
    payment.instrument === 'BANK'
  ) {
    return true;
  }
  if (payment.upiRef && /^(104|111|893)/.test(payment.upiRef)) {
    return true;
  }
  return false;
}

export async function ingestRawMessage(input: RawIngestInput): Promise<IngestOutcome> {
  const connection = db();
  const fp = fingerprint(input);

  const seen = await connection.execute('SELECT 1 FROM seen_messages WHERE hash = ? LIMIT 1', [fp]);
  if (seen.rows.length > 0) {
    return 'duplicate';
  }

  const parsed = parsePayment({
    source: input.source,
    origin: input.origin,
    title: input.title,
    body: input.body,
  });

  await connection.execute('INSERT OR REPLACE INTO seen_messages(hash, seen_at) VALUES(?, ?)', [
    fp,
    Date.now(),
  ]);

  const rawText = `${input.title ?? ''} ${input.body}`.trim();

  if (!parsed.ok) {
    await connection.execute(
      `INSERT INTO ignored_messages(source, origin, body, received_at, reason)
       VALUES(?, ?, ?, ?, ?)`,
      [input.source, input.origin, rawText, input.postedAt, parsed.reason],
    );
    await trimIgnored();
    return 'ignored';
  }

  const related = await findRelated(parsed.payment, input);
  if (related) {
    await enrichExisting(related.existing, parsed.payment, input, rawText, related.forceCredit);
    return 'merged';
  }

  const rules = await listCategoryRules();
  const classified = classifyTransaction({
    counterparty: parsed.payment.counterparty,
    rawText,
    direction: parsed.payment.direction,
    userRules: rules,
  });
  const excluded =
    classified.excluded || isVerificationNoise(parsed.payment, rawText) ? 1 : 0;
  const locked = classified.matchedRule ? 1 : 0;

  await connection.execute(
    `INSERT INTO transactions
       (amount, direction, payment_mode, category, counterparty, vpa, upi_ref, account_tail,
        instrument, occurred_at, created_at, source, origin, note, excluded, category_locked, raw_text)
     VALUES(?, ?, 'UPI', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      parsed.payment.amount,
      parsed.payment.direction,
      classified.category,
      classified.counterparty,
      parsed.payment.vpa,
      parsed.payment.upiRef,
      parsed.payment.accountTail,
      parsed.payment.instrument,
      input.postedAt,
      Date.now(),
      input.source,
      input.origin,
      classified.note,
      excluded,
      locked,
      rawText,
    ],
  );

  return 'inserted';
}

interface RelatedMatch {
  existing: Transaction;
  forceCredit: boolean;
}

/**
 * Finds an existing row that represents the same real payment.
 *
 * Four rules:
 *  1. Identical UPI reference is conclusive, whatever the timing.
 *  2. Same amount + direction within 10 minutes across different channels, different
 *     client origins (e.g. GPay vs Bank app), or when one side has no UPI ref
 *     (never collapsing two distinct valid UPI refs).
 *  3. Cross-direction phantom guard: a notification DEBIT without UPI ref (e.g. "View"
 *     or self-name) within 3 minutes of a bank SMS CREDIT for the same amount.
 *  4. Same-day autopay/subscription guard when both sides have no UPI ref and share
 *     the same counterparty within 12 hours.
 */
async function findRelated(
  payment: ParsedPayment,
  input: RawIngestInput,
): Promise<RelatedMatch | null> {
  const connection = db();

  if (payment.upiRef) {
    const byRef = await connection.execute(
      'SELECT * FROM transactions WHERE upi_ref = ? LIMIT 1',
      [payment.upiRef],
    );
    if (byRef.rows.length > 0) {
      return {existing: toTransaction(byRef.rows[0]), forceCredit: false};
    }
  }

  const [sourceA, sourceB] = sourcesInChannel(input.source);
  const byAmount = await connection.execute(
    `SELECT * FROM transactions
      WHERE direction = ?
        AND ABS(amount - ?) < 0.005
        AND occurred_at BETWEEN ? AND ?
        AND (upi_ref IS NULL OR ? IS NULL OR upi_ref = ?)
        AND (
          (source <> ? AND source <> ?)
          OR COALESCE(origin, '') <> ?
          OR upi_ref IS NULL
          OR ? IS NULL
        )
      ORDER BY ABS(occurred_at - ?) ASC
      LIMIT 1`,
    [
      payment.direction,
      payment.amount,
      input.postedAt - MERGE_WINDOW_MS,
      input.postedAt + MERGE_WINDOW_MS,
      payment.upiRef,
      payment.upiRef,
      sourceA,
      sourceB,
      input.origin,
      payment.upiRef,
      input.postedAt,
    ],
  );

  if (byAmount.rows.length > 0) {
    return {existing: toTransaction(byAmount.rows[0]), forceCredit: false};
  }

  // Cross-direction phantom guard (notification DEBIT without ref <-> SMS CREDIT with ref)
  const isIncomingNotifNoRef =
    channelOf(input.source) === 'notification' &&
    payment.direction === 'DEBIT' &&
    !payment.upiRef;
  const isIncomingSmsCredit =
    channelOf(input.source) === 'sms' &&
    payment.direction === 'CREDIT' &&
    Boolean(payment.upiRef);

  if (isIncomingNotifNoRef || isIncomingSmsCredit) {
    const oppositeDir = payment.direction === 'DEBIT' ? 'CREDIT' : 'DEBIT';
    const phantomRows = await connection.execute(
      `SELECT * FROM transactions
        WHERE direction = ?
          AND ABS(amount - ?) < 0.005
          AND occurred_at BETWEEN ? AND ?
        ORDER BY ABS(occurred_at - ?) ASC
        LIMIT 5`,
      [
        oppositeDir,
        payment.amount,
        input.postedAt - PHANTOM_WINDOW_MS,
        input.postedAt + PHANTOM_WINDOW_MS,
        input.postedAt,
      ],
    );

    for (const row of phantomRows.rows) {
      const candidate = toTransaction(row);
      const cp = (candidate.counterparty ?? '').toLowerCase();
      const incomingCp = (payment.counterparty ?? '').toLowerCase();
      if (isIncomingNotifNoRef && candidate.direction === 'CREDIT' && candidate.upiRef) {
        if (!incomingCp || incomingCp === 'view' || cp.includes(incomingCp.split(' ')[0] ?? '')) {
          return {existing: candidate, forceCredit: true};
        }
      }
      if (
        isIncomingSmsCredit &&
        candidate.direction === 'DEBIT' &&
        candidate.source === 'notification' &&
        !candidate.upiRef
      ) {
        if (!cp || cp === 'view' || incomingCp.includes(cp.split(' ')[0] ?? '')) {
          return {existing: candidate, forceCredit: true};
        }
      }
    }
  }

  // Same-day autopay guard (both lack UPI ref, same non-empty counterparty within 12h)
  if (!payment.upiRef && payment.counterparty) {
    const byAutopay = await connection.execute(
      `SELECT * FROM transactions
        WHERE direction = ?
          AND ABS(amount - ?) < 0.005
          AND upi_ref IS NULL
          AND LOWER(TRIM(COALESCE(counterparty, ''))) = ?
          AND occurred_at BETWEEN ? AND ?
        ORDER BY ABS(occurred_at - ?) ASC
        LIMIT 1`,
      [
        payment.direction,
        payment.amount,
        payment.counterparty.trim().toLowerCase(),
        input.postedAt - AUTOPAY_WINDOW_MS,
        input.postedAt + AUTOPAY_WINDOW_MS,
        input.postedAt,
      ],
    );
    if (byAutopay.rows.length > 0) {
      return {existing: toTransaction(byAutopay.rows[0]), forceCredit: false};
    }
  }

  return null;
}

/** A VPA-derived name is worse than a real merchant name; longer usually wins. */
function betterName(existing: string | null, incoming: string | null): string | null {
  if (!existing) {
    return incoming;
  }
  if (!incoming) {
    return existing;
  }
  const existingIsHandle = existing.includes('@');
  const incomingIsHandle = incoming.includes('@');
  if (existingIsHandle && !incomingIsHandle) {
    return incoming;
  }
  if (!existingIsHandle && incomingIsHandle) {
    return existing;
  }
  return incoming.length > existing.length ? incoming : existing;
}

async function enrichExisting(
  existing: Transaction,
  payment: ParsedPayment,
  input: RawIngestInput,
  rawText: string,
  forceCredit = false,
): Promise<void> {
  const connection = db();

  const nextDirection: Direction = forceCredit ? 'CREDIT' : existing.direction;
  const mergedCp = betterName(existing.counterparty, payment.counterparty);
  const classified = classifyTransaction({
    counterparty: mergedCp,
    rawText: `${existing.rawText ?? ''} ${rawText}`,
    direction: nextDirection,
    userRules: await listCategoryRules(),
    note: existing.note,
  });
  const category = forceCredit
    ? 'Income'
    : existing.categoryLocked
      ? existing.category
      : classified.category;
  const counterparty =
    category === 'Investment' && nextDirection === 'DEBIT'
      ? 'Invest'
      : classified.counterparty ?? mergedCp;
  const nextNote = existing.note ?? classified.note;

  await connection.execute(
    `UPDATE transactions SET
       direction    = ?,
       counterparty = ?,
       note         = COALESCE(note, ?),
       vpa          = COALESCE(vpa, ?),
       upi_ref      = COALESCE(upi_ref, ?),
       account_tail = COALESCE(account_tail, ?),
       instrument   = COALESCE(instrument, ?),
       occurred_at  = MIN(occurred_at, ?),
       source       = CASE WHEN ? = 1 THEN ? ELSE source END,
       category     = ?,
       raw_text     = CASE
                        WHEN raw_text IS NULL THEN ?
                        WHEN instr(raw_text, ?) > 0 THEN raw_text
                        ELSE raw_text || char(10) || '---' || char(10) || ?
                      END
     WHERE id = ?`,
    [
      nextDirection,
      counterparty,
      nextNote,
      payment.vpa,
      payment.upiRef,
      payment.accountTail,
      payment.instrument,
      input.postedAt,
      forceCredit && channelOf(input.source) === 'sms' ? 1 : 0,
      input.source,
      category,
      rawText,
      rawText,
      rawText,
      existing.id,
    ],
  );
}

async function trimIgnored(): Promise<void> {
  await db().execute(
    `DELETE FROM ignored_messages WHERE id NOT IN
       (SELECT id FROM ignored_messages ORDER BY received_at DESC LIMIT ?)`,
    [IGNORED_LIMIT],
  );
}

// ---------------------------------------------------------------------------
// manual CRUD
// ---------------------------------------------------------------------------

export interface ManualTransactionInput {
  amount: number;
  direction: Direction;
  paymentMode: PaymentMode;
  category: string;
  counterparty: string | null;
  note: string | null;
  accountTail?: string | null;
  occurredAt: number;
}

export async function insertManualTransaction(input: ManualTransactionInput): Promise<number> {
  let counterparty = input.counterparty?.trim() || null;
  let note = input.note?.trim() || null;
  if (input.category === 'Investment' && input.direction === 'DEBIT') {
    if (counterparty && counterparty.toLowerCase() !== 'invest' && !note) {
      note = counterparty;
    }
    counterparty = 'Invest';
  }
  const accountTail = input.accountTail?.trim() || null;

  const result = await db().execute(
    `INSERT INTO transactions
       (amount, direction, payment_mode, category, counterparty, vpa, upi_ref, account_tail,
        instrument, occurred_at, created_at, source, origin, note, excluded, category_locked, raw_text)
     VALUES(?, ?, ?, ?, ?, NULL, NULL, ?, NULL, ?, ?, 'manual', NULL, ?, 0, 1, NULL)`,
    [
      input.amount,
      input.direction,
      input.paymentMode,
      input.category,
      counterparty,
      accountTail,
      input.occurredAt,
      Date.now(),
      note,
    ],
  );
  return result.insertId ?? 0;
}

export interface TransactionPatch {
  amount?: number;
  direction?: Direction;
  paymentMode?: PaymentMode;
  category?: string;
  counterparty?: string | null;
  note?: string | null;
  accountTail?: string | null;
  excluded?: boolean;
  occurredAt?: number;
}

export async function updateTransaction(id: number, patch: TransactionPatch): Promise<void> {
  const sets: string[] = [];
  const params: Scalar[] = [];

  const push = (column: string, value: Scalar) => {
    sets.push(`${column} = ?`);
    params.push(value);
  };

  let nextCp = patch.counterparty;
  let nextNote = patch.note;
  if (patch.category === 'Investment' && (patch.direction ?? 'DEBIT') === 'DEBIT') {
    if (nextCp && nextCp.trim().toLowerCase() !== 'invest' && !nextNote?.trim()) {
      nextNote = nextCp.trim();
    }
    nextCp = 'Invest';
  }

  if (patch.amount !== undefined) {
    push('amount', patch.amount);
  }
  if (patch.direction !== undefined) {
    push('direction', patch.direction);
  }
  if (patch.paymentMode !== undefined) {
    push('payment_mode', patch.paymentMode);
  }
  if (patch.category !== undefined) {
    push('category', patch.category);
    push('category_locked', 1);
  }
  if (nextCp !== undefined) {
    push('counterparty', nextCp);
  }
  if (nextNote !== undefined) {
    push('note', nextNote);
  }
  if (patch.accountTail !== undefined) {
    push('account_tail', patch.accountTail?.trim() || null);
  }
  if (patch.excluded !== undefined) {
    push('excluded', patch.excluded ? 1 : 0);
  }
  if (patch.occurredAt !== undefined) {
    push('occurred_at', patch.occurredAt);
  }

  if (sets.length === 0) {
    return;
  }

  params.push(id);
  await db().execute(`UPDATE transactions SET ${sets.join(', ')} WHERE id = ?`, params);
}

export async function deleteTransaction(id: number): Promise<void> {
  await db().execute('DELETE FROM transactions WHERE id = ?', [id]);
}

// ---------------------------------------------------------------------------
// queries
// ---------------------------------------------------------------------------

/** `mode = 'ALL'` includes everything; anything else filters to that mode. */
function modeClause(mode: ModeFilter | undefined, clauses: string[], params: Scalar[]): void {
  if (mode && mode !== 'ALL') {
    clauses.push('payment_mode = ?');
    params.push(mode);
  }
}

/** `account = 'ALL'` includes every bank account; `'UNLINKED'` matches null/empty tail. */
function accountClause(
  account: AccountFilter | undefined,
  clauses: string[],
  params: Scalar[],
): void {
  if (!account || account === 'ALL') {
    return;
  }
  if (account === 'UNLINKED') {
    clauses.push("TRIM(COALESCE(account_tail, '')) = ''");
  } else {
    clauses.push('TRIM(COALESCE(account_tail, \'\')) = ?');
    params.push(account.trim());
  }
}

export interface ListOptions {
  range?: Range;
  search?: string;
  direction?: Direction | 'ALL';
  mode?: ModeFilter;
  account?: AccountFilter;
  category?: string | null;
  excludeCategories?: string[];
  limit?: number;
}

export async function listTransactions(options: ListOptions = {}): Promise<Transaction[]> {
  const clauses: string[] = ['1 = 1'];
  const params: Scalar[] = [];

  if (options.range) {
    clauses.push('occurred_at BETWEEN ? AND ?');
    params.push(options.range.from, options.range.to);
  }
  if (options.direction && options.direction !== 'ALL') {
    clauses.push('direction = ?');
    params.push(options.direction);
  }
  modeClause(options.mode, clauses, params);
  accountClause(options.account, clauses, params);
  if (options.category) {
    clauses.push('category = ?');
    params.push(options.category);
  }
  if (options.excludeCategories && options.excludeCategories.length > 0) {
    const placeholders = options.excludeCategories.map(() => '?').join(', ');
    clauses.push(`category NOT IN (${placeholders})`);
    params.push(...options.excludeCategories);
  }
  if (options.search && options.search.trim()) {
    const term = `%${options.search.trim().toLowerCase()}%`;
    clauses.push(
      '(LOWER(COALESCE(counterparty, \'\')) LIKE ? OR LOWER(COALESCE(note, \'\')) LIKE ? ' +
        'OR LOWER(category) LIKE ? OR CAST(amount AS TEXT) LIKE ?)',
    );
    params.push(term, term, term, term);
  }

  const limit = options.limit ?? 500;
  params.push(limit);

  const result = await db().execute(
    `SELECT * FROM transactions WHERE ${clauses.join(' AND ')}
     ORDER BY occurred_at DESC, id DESC LIMIT ?`,
    params,
  );
  return result.rows.map(toTransaction);
}

export async function periodSummary(
  range: Range,
  mode: ModeFilter = 'ALL',
  account: AccountFilter = 'ALL',
): Promise<PeriodSummary> {
  const clauses = ['excluded = 0', 'occurred_at BETWEEN ? AND ?'];
  const params: Scalar[] = [range.from, range.to];
  modeClause(mode, clauses, params);
  accountClause(account, clauses, params);

  const result = await db().execute(
    `SELECT
       COALESCE(SUM(CASE WHEN direction = 'DEBIT' AND category <> 'Investment' THEN amount ELSE 0 END), 0) AS spend,
       COALESCE(SUM(CASE WHEN direction = 'DEBIT' AND category = 'Investment' THEN amount ELSE 0 END), 0) AS invested,
       COALESCE(SUM(CASE WHEN direction = 'DEBIT' AND category = 'Investment' THEN 1 ELSE 0 END), 0) AS invest_cnt,
       COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE 0 END), 0) AS income,
       COUNT(*) AS cnt,
       COALESCE(MAX(CASE WHEN direction = 'DEBIT' AND category <> 'Investment' THEN amount ELSE 0 END), 0) AS largest,
       MIN(occurred_at) AS first_at,
       MAX(occurred_at) AS last_at,
       COALESCE(SUM(CASE WHEN direction = 'DEBIT' AND category <> 'Investment' AND payment_mode = 'UPI'  THEN amount ELSE 0 END), 0) AS upi_spend,
       COALESCE(SUM(CASE WHEN direction = 'DEBIT' AND category <> 'Investment' AND payment_mode = 'CASH' THEN amount ELSE 0 END), 0) AS cash_spend
     FROM transactions
     WHERE ${clauses.join(' AND ')}`,
    params,
  );

  const row = result.rows[0] ?? {};
  return {
    spend: num(row.spend),
    invested: num(row.invested),
    investmentCount: num(row.invest_cnt),
    income: num(row.income),
    count: num(row.cnt),
    largest: num(row.largest),
    firstAt: row.first_at == null ? null : num(row.first_at),
    lastAt: row.last_at == null ? null : num(row.last_at),
    upiSpend: num(row.upi_spend),
    cashSpend: num(row.cash_spend),
  };
}

export async function spendTotal(
  range: Range,
  mode: ModeFilter = 'ALL',
  account: AccountFilter = 'ALL',
): Promise<number> {
  const clauses = [
    "direction = 'DEBIT'",
    "category <> 'Investment'",
    'excluded = 0',
    'occurred_at BETWEEN ? AND ?',
  ];
  const params: Scalar[] = [range.from, range.to];
  modeClause(mode, clauses, params);
  accountClause(account, clauses, params);

  const result = await db().execute(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM transactions WHERE ${clauses.join(' AND ')}`,
    params,
  );
  return num(result.rows[0]?.total);
}

export async function categoryTotals(
  range: Range,
  mode: ModeFilter = 'ALL',
  includeInvestments = false,
  account: AccountFilter = 'ALL',
): Promise<CategoryTotal[]> {
  const clauses = ["direction = 'DEBIT'", 'excluded = 0', 'occurred_at BETWEEN ? AND ?'];
  if (!includeInvestments) {
    clauses.push("category <> 'Investment'");
  }
  const params: Scalar[] = [range.from, range.to];
  modeClause(mode, clauses, params);
  accountClause(account, clauses, params);

  const result = await db().execute(
    `SELECT category, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS cnt
       FROM transactions
      WHERE ${clauses.join(' AND ')}
      GROUP BY category
      ORDER BY total DESC`,
    params,
  );
  return result.rows.map(row => ({
    category: str(row.category, UNCATEGORISED),
    total: num(row.total),
    count: num(row.cnt),
  }));
}

/**
 * Grouped with SQLite's 'localtime' modifier so month boundaries match the
 * user's timezone rather than UTC.
 */
export async function monthlyTotals(
  range: Range,
  mode: ModeFilter = 'ALL',
  account: AccountFilter = 'ALL',
): Promise<MonthTotal[]> {
  const clauses = ['excluded = 0', 'occurred_at BETWEEN ? AND ?'];
  const params: Scalar[] = [range.from, range.to];
  modeClause(mode, clauses, params);
  accountClause(account, clauses, params);

  const result = await db().execute(
    `SELECT strftime('%Y-%m', occurred_at / 1000, 'unixepoch', 'localtime') AS month_key,
            COALESCE(SUM(CASE WHEN direction = 'DEBIT' AND category <> 'Investment' THEN amount ELSE 0 END), 0) AS spend,
            COALESCE(SUM(CASE WHEN direction = 'DEBIT' AND category = 'Investment' THEN amount ELSE 0 END), 0) AS invested,
            COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE 0 END), 0) AS income,
            COUNT(*) AS cnt
       FROM transactions
      WHERE ${clauses.join(' AND ')}
      GROUP BY month_key
      ORDER BY month_key ASC`,
    params,
  );
  return result.rows.map(row => ({
    monthKey: str(row.month_key),
    spend: num(row.spend),
    invested: num(row.invested),
    income: num(row.income),
    count: num(row.cnt),
  }));
}

export async function dailySpend(
  range: Range,
  mode: ModeFilter = 'ALL',
  account: AccountFilter = 'ALL',
): Promise<Array<{dayKey: string; total: number}>> {
  const clauses = [
    "direction = 'DEBIT'",
    "category <> 'Investment'",
    'excluded = 0',
    'occurred_at BETWEEN ? AND ?',
  ];
  const params: Scalar[] = [range.from, range.to];
  modeClause(mode, clauses, params);
  accountClause(account, clauses, params);

  const result = await db().execute(
    `SELECT strftime('%Y-%m-%d', occurred_at / 1000, 'unixepoch', 'localtime') AS day_key,
            COALESCE(SUM(amount), 0) AS total
       FROM transactions
      WHERE ${clauses.join(' AND ')}
      GROUP BY day_key
      ORDER BY day_key ASC`,
    params,
  );
  return result.rows.map(row => ({dayKey: str(row.day_key), total: num(row.total)}));
}

export async function weekdaySpend(
  range: Range,
  mode: ModeFilter = 'ALL',
  account: AccountFilter = 'ALL',
): Promise<Array<{weekday: number; total: number}>> {
  const clauses = [
    "direction = 'DEBIT'",
    "category <> 'Investment'",
    'excluded = 0',
    'occurred_at BETWEEN ? AND ?',
  ];
  const params: Scalar[] = [range.from, range.to];
  modeClause(mode, clauses, params);
  accountClause(account, clauses, params);

  const result = await db().execute(
    `SELECT CAST(strftime('%w', occurred_at / 1000, 'unixepoch', 'localtime') AS INTEGER) AS weekday,
            COALESCE(SUM(amount), 0) AS total
       FROM transactions
      WHERE ${clauses.join(' AND ')}
      GROUP BY weekday
      ORDER BY weekday ASC`,
    params,
  );
  return result.rows.map(row => ({weekday: num(row.weekday), total: num(row.total)}));
}

export async function topMerchants(
  range: Range,
  limit = 8,
  mode: ModeFilter = 'ALL',
  account: AccountFilter = 'ALL',
): Promise<MerchantTotal[]> {
  const clauses = [
    "direction = 'DEBIT'",
    "category <> 'Investment'",
    'excluded = 0',
    "TRIM(COALESCE(counterparty, '')) <> ''",
    "LOWER(TRIM(counterparty)) <> 'invest'",
    'occurred_at BETWEEN ? AND ?',
  ];
  const params: Scalar[] = [range.from, range.to];
  modeClause(mode, clauses, params);
  accountClause(account, clauses, params);
  params.push(limit);

  const result = await db().execute(
    `SELECT TRIM(counterparty) AS name,
            COALESCE(SUM(amount), 0) AS total,
            COUNT(*) AS cnt
       FROM transactions
      WHERE ${clauses.join(' AND ')}
      GROUP BY name
      ORDER BY total DESC
      LIMIT ?`,
    params,
  );
  return result.rows.map(row => ({
    counterparty: str(row.name, 'Unknown'),
    total: num(row.total),
    count: num(row.cnt),
  }));
}

export async function investmentHoldings(
  range: Range,
  mode: ModeFilter = 'ALL',
  account: AccountFilter = 'ALL',
): Promise<InvestmentHolding[]> {
  const clauses = [
    "direction = 'DEBIT'",
    "category = 'Investment'",
    'excluded = 0',
    'occurred_at BETWEEN ? AND ?',
  ];
  const params: Scalar[] = [range.from, range.to];
  modeClause(mode, clauses, params);
  accountClause(account, clauses, params);

  const result = await db().execute(
    `SELECT
       CASE
         WHEN note IS NOT NULL AND TRIM(note) <> '' AND LOWER(TRIM(note)) <> 'invest' THEN TRIM(note)
         WHEN counterparty IS NOT NULL AND TRIM(counterparty) <> '' AND LOWER(TRIM(counterparty)) <> 'invest' THEN TRIM(counterparty)
         WHEN ABS(amount - 2000) < 0.01 THEN 'Monthly SIP (₹2k)'
         ELSE 'Core Portfolio / Direct Equity'
       END AS holding_name,
       COALESCE(SUM(amount), 0) AS total,
       COUNT(*) AS cnt,
       MAX(occurred_at) AS last_at
     FROM transactions
     WHERE ${clauses.join(' AND ')}
     GROUP BY holding_name
     ORDER BY total DESC`,
    params,
  );

  return result.rows.map(row => ({
    name: str(row.holding_name, 'Core Portfolio'),
    total: num(row.total),
    count: num(row.cnt),
    lastAt: num(row.last_at),
  }));
}

export async function incomeBreakdown(
  range: Range,
  mode: ModeFilter = 'ALL',
  account: AccountFilter = 'ALL',
): Promise<IncomeBreakdown> {
  const clauses = ["direction = 'CREDIT'", 'excluded = 0', 'occurred_at BETWEEN ? AND ?'];
  const params: Scalar[] = [range.from, range.to];
  modeClause(mode, clauses, params);
  accountClause(account, clauses, params);

  const result = await db().execute(
    `SELECT
       COALESCE(SUM(CASE
         WHEN NOT (
           category = 'Shopping'
           OR ABS(amount - 13428) < 0.01
           OR ABS(amount - 29100) < 0.01
           OR LOWER(COALESCE(counterparty, '')) LIKE '%dipesh%'
         ) AND (
           LOWER(COALESCE(counterparty, '')) LIKE '%interest%'
           OR LOWER(COALESCE(counterparty, '')) LIKE '%salary%'
           OR amount >= 5000
           OR (TRIM(COALESCE(counterparty, '')) = '' AND amount >= 1000)
         ) THEN amount ELSE 0 END), 0) AS core_income,
       COALESCE(SUM(CASE
         WHEN category = 'Shopping'
           OR ABS(amount - 13428) < 0.01
           OR ABS(amount - 29100) < 0.01
           OR LOWER(COALESCE(counterparty, '')) LIKE '%dipesh%'
         THEN amount ELSE 0 END), 0) AS rebound_refunds,
       COALESCE(SUM(CASE
         WHEN NOT (
           category = 'Shopping'
           OR ABS(amount - 13428) < 0.01
           OR ABS(amount - 29100) < 0.01
           OR LOWER(COALESCE(counterparty, '')) LIKE '%dipesh%'
         ) AND NOT (
           LOWER(COALESCE(counterparty, '')) LIKE '%interest%'
           OR LOWER(COALESCE(counterparty, '')) LIKE '%salary%'
           OR amount >= 5000
           OR (TRIM(COALESCE(counterparty, '')) = '' AND amount >= 1000)
         ) THEN amount ELSE 0 END), 0) AS peer_splits
     FROM transactions
     WHERE ${clauses.join(' AND ')}`,
    params,
  );

  const row = result.rows[0] ?? {};
  return {
    coreIncome: num(row.core_income),
    reboundRefunds: num(row.rebound_refunds),
    peerSplits: num(row.peer_splits),
  };
}

export async function routineSpots(
  range: Range,
  mode: ModeFilter = 'ALL',
  limit = 6,
  account: AccountFilter = 'ALL',
): Promise<HabitSpot[]> {
  const clauses = [
    "direction = 'DEBIT'",
    "category <> 'Investment'",
    'excluded = 0',
    "TRIM(COALESCE(counterparty, '')) <> ''",
    'occurred_at BETWEEN ? AND ?',
  ];
  const params: Scalar[] = [range.from, range.to];
  modeClause(mode, clauses, params);
  accountClause(account, clauses, params);
  params.push(limit);

  const result = await db().execute(
    `SELECT TRIM(counterparty) AS name,
            MAX(category) AS category,
            COALESCE(SUM(amount), 0) AS total,
            COUNT(*) AS cnt
       FROM transactions
      WHERE ${clauses.join(' AND ')}
      GROUP BY name
      HAVING cnt >= 2
      ORDER BY cnt DESC, total DESC
      LIMIT ?`,
    params,
  );

  return result.rows.map(row => {
    const total = num(row.total);
    const count = num(row.cnt);
    return {
      name: str(row.name),
      category: str(row.category, UNCATEGORISED),
      total,
      count,
      avgTicket: count > 0 ? total / count : 0,
    };
  });
}

const NON_PEER_CP = /(bank|interest|myntra|google|amazon|flipkart|fipkart|spotify|dipesh|invest|uber|ola|metro|auto|starbucks|hubble|blinkit|reliance|pills|medical|apollo|hair|tyre|naturals|bakery|butterfly|canteen|godrej|vi\b|fuel|meds|water|navratri)/i;

export async function peerSplitsSummary(
  range: Range,
  mode: ModeFilter = 'ALL',
  account: AccountFilter = 'ALL',
): Promise<PeerSplitItem[]> {
  const txns = await listTransactions({range, mode, account, limit: 2000});
  const active = txns.filter(t => !t.excluded && t.category !== 'Investment');

  const peerFirstNames = new Set<string>();
  for (const t of active) {
    const cp = t.counterparty?.trim();
    if (!cp || NON_PEER_CP.test(cp)) {
      continue;
    }
    const first = cp.split(/\s+/)[0]?.toLowerCase();
    if (!first || first.length < 2) {
      continue;
    }
    if (t.direction === 'CREDIT' || t.category === 'Transfer') {
      peerFirstNames.add(first);
    }
  }

  const map = new Map<string, {display: string; received: number; paid: number; count: number}>();
  for (const t of active) {
    const cp = t.counterparty?.trim();
    if (!cp || NON_PEER_CP.test(cp)) {
      continue;
    }
    const first = cp.split(/\s+/)[0]?.toLowerCase();
    if (!first || !peerFirstNames.has(first)) {
      continue;
    }

    const entry = map.get(first) ?? {
      display: cp.split(/\s+/)[0] ?? cp,
      received: 0,
      paid: 0,
      count: 0,
    };
    if (t.direction === 'CREDIT') {
      entry.received += t.amount;
    } else {
      entry.paid += t.amount;
    }
    entry.count += 1;
    map.set(first, entry);
  }

  return Array.from(map.values())
    .map(item => ({
      person: item.display,
      received: item.received,
      paid: item.paid,
      net: item.received - item.paid,
      count: item.count,
    }))
    .sort((a, b) => b.received + b.paid - (a.received + a.paid));
}

/**
 * Multi-account summary across all stored bank account tails (e.g. '911')
 * plus an 'UNLINKED' bucket for cash/untagged rows.
 */
export async function listBankAccounts(
  range?: Range,
  mode: ModeFilter = 'ALL',
): Promise<BankAccountSummary[]> {
  const clauses = ['excluded = 0'];
  const params: Scalar[] = [];
  if (range) {
    clauses.push('occurred_at BETWEEN ? AND ?');
    params.push(range.from, range.to);
  }
  modeClause(mode, clauses, params);

  const result = await db().execute(
    `SELECT
       CASE
         WHEN account_tail IS NULL OR TRIM(account_tail) = '' THEN 'UNLINKED'
         ELSE TRIM(account_tail)
       END AS tail,
       COALESCE(SUM(CASE WHEN direction = 'DEBIT' AND category <> 'Investment' THEN amount ELSE 0 END), 0) AS spend,
       COALESCE(SUM(CASE WHEN direction = 'DEBIT' AND category = 'Investment' THEN amount ELSE 0 END), 0) AS invested,
       COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE 0 END), 0) AS income,
       COUNT(*) AS cnt
     FROM transactions
     WHERE ${clauses.join(' AND ')}
     GROUP BY tail
     ORDER BY (spend + invested + income) DESC`,
    params,
  );

  const customLabelsResult = await db().execute(
    "SELECT key, value FROM settings WHERE key LIKE 'account_label_%'",
  );
  const labelMap = new Map<string, string>();
  for (const r of customLabelsResult.rows) {
    const k = str(r.key).replace('account_label_', '');
    const v = str(r.value).trim();
    if (k && v) {
      labelMap.set(k, v);
    }
  }

  return result.rows.map(row => {
    const tail = str(row.tail, 'UNLINKED');
    const custom = labelMap.get(tail);
    const defaultLabel = tail === 'UNLINKED' ? 'Cash / Unlinked' : `A/c ••${tail}`;
    return {
      accountTail: tail,
      label: custom ? `${custom} (••${tail})` : defaultLabel,
      spend: num(row.spend),
      invested: num(row.invested),
      income: num(row.income),
      count: num(row.cnt),
    };
  });
}

export async function setAccountLabel(accountTail: string, label: string): Promise<void> {
  const cleanTail = accountTail.trim();
  if (!cleanTail) {
    return;
  }
  await setSetting(`account_label_${cleanTail}`, label.trim());
}

/**
 * Out-of-the-box behavioural and velocity analytics + AI-ready structured briefs
 * for the selected date range, payment mode, and bank account.
 */
export async function insightsDeepDive(
  range: Range,
  mode: ModeFilter = 'ALL',
  account: AccountFilter = 'ALL',
): Promise<InsightsDeepDive> {
  const txns = await listTransactions({range, mode, account, limit: 5000});
  const active = txns.filter(t => !t.excluded);
  const livingDebits = active.filter(t => t.direction === 'DEBIT' && t.category !== 'Investment');
  const investments = active.filter(t => t.direction === 'DEBIT' && t.category === 'Investment');
  const credits = active.filter(t => t.direction === 'CREDIT');

  const spendSum = livingDebits.reduce((s, t) => s + t.amount, 0);
  const investSum = investments.reduce((s, t) => s + t.amount, 0);
  const incomeSum = credits.reduce((s, t) => s + t.amount, 0);

  // Time-of-day profile
  const slotDefs: Array<{key: string; label: string; window: string}> = [
    {key: 'morning', label: 'Morning', window: '6am – 12pm'},
    {key: 'afternoon', label: 'Afternoon', window: '12pm – 5pm'},
    {key: 'evening', label: 'Evening', window: '5pm – 9pm'},
    {key: 'night', label: 'Late Night', window: '9pm – 6am'},
  ];
  const slotTotals = new Map<string, {spend: number; count: number}>(
    slotDefs.map(s => [s.key, {spend: 0, count: 0}]),
  );

  // Ticket size tiers
  const tierDefs: Array<{key: string; label: string}> = [
    {key: 'micro', label: 'Micro (≤ ₹100)'},
    {key: 'routine', label: 'Routine (₹101 – ₹500)'},
    {key: 'major', label: 'Major (> ₹500)'},
  ];
  const tierTotals = new Map<string, {spend: number; count: number}>(
    tierDefs.map(t => [t.key, {spend: 0, count: 0}]),
  );

  const activeDaySet = new Set<string>();
  let minTs = range.to;
  let maxTs = range.from;

  for (const t of active) {
    if (t.occurredAt < minTs) {
      minTs = t.occurredAt;
    }
    if (t.occurredAt > maxTs) {
      maxTs = t.occurredAt;
    }
  }

  for (const t of livingDebits) {
    const d = new Date(t.occurredAt);
    activeDaySet.add(dayKey(d));
    const hr = d.getHours();
    const slotKey =
      hr >= 6 && hr < 12
        ? 'morning'
        : hr >= 12 && hr < 17
          ? 'afternoon'
          : hr >= 17 && hr < 21
            ? 'evening'
            : 'night';
    const slot = slotTotals.get(slotKey)!;
    slot.spend += t.amount;
    slot.count += 1;

    const tierKey = t.amount <= 100 ? 'micro' : t.amount <= 500 ? 'routine' : 'major';
    const tier = tierTotals.get(tierKey)!;
    tier.spend += t.amount;
    tier.count += 1;
  }

  const timeSlots: TimeSlotStat[] = slotDefs.map(s => ({
    ...s,
    spend: slotTotals.get(s.key)?.spend ?? 0,
    count: slotTotals.get(s.key)?.count ?? 0,
  }));

  const ticketTiers: TicketTierStat[] = tierDefs.map(t => ({
    ...t,
    spend: tierTotals.get(t.key)?.spend ?? 0,
    count: tierTotals.get(t.key)?.count ?? 0,
  }));

  const effectiveEnd = Math.min(Date.now(), range.to);
  const effectiveStart = active.length > 0 ? Math.max(range.from, minTs) : range.from;
  const totalDaysInPeriod = Math.max(
    1,
    Math.ceil((Math.max(effectiveEnd, effectiveStart) - effectiveStart + 1) / DAY_MS),
  );
  const activeDays = activeDaySet.size;
  const zeroSpendDays = Math.max(0, totalDaysInPeriod - activeDays);
  const avgTicket = livingDebits.length > 0 ? spendSum / livingDebits.length : 0;
  const dailyBurnRate = spendSum / totalDaysInPeriod;
  const projected30d = dailyBurnRate * 30;

  const topOutliers = [...livingDebits]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 4);

  // Build concise, AI-ready analyst briefs
  const briefs: AnalystBrief[] = [];

  if (investSum > 0 || spendSum > 0) {
    const totalOut = investSum + spendSum;
    const invShare = totalOut > 0 ? Math.round((investSum / totalOut) * 100) : 0;
    briefs.push({
      id: 'allocation',
      title: 'Capital Deployment',
      metric: `${invShare}% Invested`,
      detail: `${money(investSum)} went into investments vs ${money(spendSum)} in living expenses.`,
    });
  }

  const peakSlot = [...timeSlots].sort((a, b) => b.spend - a.spend)[0];
  if (peakSlot && peakSlot.spend > 0) {
    const share = spendSum > 0 ? Math.round((peakSlot.spend / spendSum) * 100) : 0;
    briefs.push({
      id: 'window',
      title: `Peak Window · ${peakSlot.label}`,
      metric: `${share}% of Spend`,
      detail: `${peakSlot.count} payments between ${peakSlot.window} totalling ${money(peakSlot.spend)}.`,
    });
  }

  const microStat = ticketTiers[0];
  if (microStat && livingDebits.length > 0) {
    const freqPct = Math.round((microStat.count / livingDebits.length) * 100);
    briefs.push({
      id: 'micro',
      title: 'Small-Ticket Habit',
      metric: `${microStat.count}x ≤ ₹100`,
      detail: `${freqPct}% of your transactions are under ₹100, adding up to ${money(microStat.spend)}.`,
    });
  }

  if (totalDaysInPeriod >= 3) {
    briefs.push({
      id: 'discipline',
      title: 'Spend Discipline',
      metric: `${zeroSpendDays} Zero-Spend Days`,
      detail: `Spent on ${activeDays} of ${totalDaysInPeriod} days · burn rate ${money(dailyBurnRate)}/day (${money( incomeSum - spendSum - investSum )} net cashflow).`,
    });
  }

  return {
    timeSlots,
    ticketTiers,
    activeDays,
    zeroSpendDays,
    totalDaysInPeriod,
    avgTicket,
    dailyBurnRate,
    projected30d,
    topOutliers,
    briefs,
  };
}

/** Oldest transaction timestamp, used to bound "All time" analysis. */
export async function earliestTimestamp(): Promise<number | null> {
  const result = await db().execute('SELECT MIN(occurred_at) AS first_at FROM transactions');
  const value = result.rows[0]?.first_at;
  return value == null ? null : num(value);
}

export async function transactionCount(): Promise<number> {
  const result = await db().execute('SELECT COUNT(*) AS cnt FROM transactions');
  return num(result.rows[0]?.cnt);
}

// ---------------------------------------------------------------------------
// ignored messages
// ---------------------------------------------------------------------------

export async function listIgnoredMessages(limit = 60): Promise<IgnoredMessage[]> {
  const result = await db().execute(
    'SELECT * FROM ignored_messages ORDER BY received_at DESC LIMIT ?',
    [limit],
  );
  return result.rows.map(row => ({
    id: num(row.id),
    source: str(row.source),
    origin: str(row.origin),
    body: str(row.body),
    receivedAt: num(row.received_at),
    reason: str(row.reason),
  }));
}

export async function ignoredCount(): Promise<number> {
  const result = await db().execute('SELECT COUNT(*) AS cnt FROM ignored_messages');
  return num(result.rows[0]?.cnt);
}

export async function clearIgnoredMessages(): Promise<void> {
  await db().execute('DELETE FROM ignored_messages');
}

// ---------------------------------------------------------------------------
// settings
// ---------------------------------------------------------------------------

export async function getSetting(key: string): Promise<string | null> {
  const result = await db().execute('SELECT value FROM settings WHERE key = ? LIMIT 1', [key]);
  return nstr(result.rows[0]?.value);
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db().execute('INSERT OR REPLACE INTO settings(key, value) VALUES(?, ?)', [key, value]);
}

export async function getNumberSetting(key: string, fallback: number): Promise<number> {
  const raw = await getSetting(key);
  if (raw === null) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// ---------------------------------------------------------------------------
// client & category rules ("forever rules")
// ---------------------------------------------------------------------------

export async function listCategoryRules(): Promise<CategoryRule[]> {
  const result = await db().execute(
    `SELECT keyword, category, counterparty_override, default_note, auto_exclude
       FROM category_rules
      ORDER BY LENGTH(keyword) DESC`,
  );
  return result.rows.map(row => ({
    keyword: str(row.keyword),
    category: str(row.category, UNCATEGORISED),
    counterpartyOverride: nstr(row.counterparty_override),
    defaultNote: nstr(row.default_note),
    autoExclude: bool(row.auto_exclude),
  }));
}

export interface UpsertClientRuleOptions {
  counterpartyOverride?: string | null;
  defaultNote?: string | null;
  autoExclude?: boolean;
}

/**
 * Saves a permanent client classification rule and immediately applies it
 * retroactively to all matching transactions in the database.
 */
export async function upsertCategoryRule(
  keyword: string,
  category: string,
  options: UpsertClientRuleOptions = {},
): Promise<number> {
  const cleaned = keyword.trim().toLowerCase();
  if (!cleaned) {
    return 0;
  }
  const cpOverride =
    category === 'Investment'
      ? 'Invest'
      : options.counterpartyOverride?.trim() || null;
  const defNote = options.defaultNote?.trim() || null;
  const autoExcl = options.autoExclude ? 1 : 0;

  await db().execute(
    `INSERT OR REPLACE INTO category_rules
       (keyword, category, counterparty_override, default_note, auto_exclude)
     VALUES(?, ?, ?, ?, ?)`,
    [cleaned, category, cpOverride, defNote, autoExcl],
  );

  // Retroactively apply this forever rule to all matching historical rows
  const allRows = await db().execute(
    'SELECT id, counterparty, note, raw_text, direction, excluded FROM transactions',
  );
  let updated = 0;
  for (const row of allRows.rows) {
    const cp = nstr(row.counterparty) ?? '';
    const note = nstr(row.note) ?? '';
    const raw = nstr(row.raw_text) ?? '';
    const full = `${cp} ${note} ${raw}`.toLowerCase();
    if (!matchesKeyword(full, cleaned)) {
      continue;
    }

    const nextCp =
      category === 'Investment'
        ? 'Invest'
        : cpOverride || nstr(row.counterparty);
    let nextNote = nstr(row.note);
    if (category === 'Investment' && cp && cp.toLowerCase() !== 'invest' && !nextNote) {
      nextNote = cp;
    } else if (!nextNote && defNote) {
      nextNote = defNote;
    }
    const nextExcl = options.autoExclude !== undefined ? autoExcl : num(row.excluded);

    await db().execute(
      `UPDATE transactions
          SET category = ?,
              counterparty = ?,
              note = ?,
              excluded = ?,
              category_locked = 1
        WHERE id = ?`,
      [category, nextCp, nextNote, nextExcl, num(row.id)],
    );
    updated += 1;
  }

  return updated;
}

export async function deleteCategoryRule(keyword: string): Promise<void> {
  await db().execute('DELETE FROM category_rules WHERE keyword = ?', [keyword.trim().toLowerCase()]);
}

/**
 * Re-runs categorisation over rows the user has not explicitly categorised.
 */
export async function recategoriseUnlocked(): Promise<number> {
  const connection = db();
  const rules = await listCategoryRules();
  const result = await connection.execute(
    'SELECT id, counterparty, raw_text, note, direction, category FROM transactions WHERE category_locked = 0',
  );

  let changed = 0;
  for (const row of result.rows) {
    const classified = classifyTransaction({
      counterparty: nstr(row.counterparty),
      rawText: nstr(row.raw_text),
      direction: str(row.direction, 'DEBIT') as Direction,
      userRules: rules,
      note: nstr(row.note),
    });
    if (
      classified.category !== str(row.category) ||
      classified.counterparty !== nstr(row.counterparty)
    ) {
      await connection.execute(
        'UPDATE transactions SET category = ?, counterparty = ?, note = COALESCE(note, ?) WHERE id = ?',
        [classified.category, classified.counterparty, classified.note, num(row.id)],
      );
      changed += 1;
    }
  }
  return changed;
}

// ---------------------------------------------------------------------------
// V2 smart seed & cleanup
// ---------------------------------------------------------------------------

export async function importCsvTransactions(
  csvText: string,
  clearFirst = false,
): Promise<{imported: number; skipped: number}> {
  const connection = db();
  const rows = parseCsvRows(csvText, {smartClean: true});

  if (clearFirst) {
    await connection.execute('DELETE FROM transactions');
    await connection.execute('DELETE FROM seen_messages');
  }

  let imported = 0;
  let skipped = 0;

  for (const row of rows) {
    if (!clearFirst) {
      if (row.upiRef) {
        const dup = await connection.execute(
          'SELECT 1 FROM transactions WHERE upi_ref = ? LIMIT 1',
          [row.upiRef],
        );
        if (dup.rows.length > 0) {
          skipped += 1;
          continue;
        }
      } else {
        const dup = await connection.execute(
          `SELECT 1 FROM transactions
            WHERE direction = ?
              AND ABS(amount - ?) < 0.005
              AND occurred_at BETWEEN ? AND ?
            LIMIT 1`,
          [row.direction, row.amount, row.occurredAt - 120_000, row.occurredAt + 120_000],
        );
        if (dup.rows.length > 0) {
          skipped += 1;
          continue;
        }
      }
    }

    await connection.execute(
      `INSERT INTO transactions
         (amount, direction, payment_mode, category, counterparty, vpa, upi_ref, account_tail,
          instrument, occurred_at, created_at, source, origin, note, excluded, category_locked, raw_text)
       VALUES(?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL)`,
      [
        row.amount,
        row.direction,
        row.paymentMode,
        row.category,
        row.counterparty,
        row.upiRef,
        row.accountTail,
        row.instrument,
        row.occurredAt,
        Date.now(),
        row.source,
        row.note,
        row.excluded ? 1 : 0,
        row.categoryLocked ? 1 : 0,
      ],
    );
    imported += 1;
  }

  return {imported, skipped};
}

/**
 * Wipes messed-up transaction history (e.g. after an unwanted 1-year SMS sync)
 * and restores the clean `data.csv` seed dataset.
 */
export async function resetAndRestoreSeedCsv(): Promise<number> {
  const {imported} = await importCsvTransactions(SEED_CSV, true);
  await setSetting('v2_seeded_csv', '1');
  await setSetting('v2_smart_cleanup_done', '1');
  return imported;
}

export async function seedDatabaseIfEmpty(): Promise<number> {
  const seededFlag = await getSetting('v2_seeded_csv');
  const count = await transactionCount();
  if (count > 0 || seededFlag === '1') {
    return 0;
  }
  const {imported} = await importCsvTransactions(SEED_CSV, false);
  await setSetting('v2_seeded_csv', '1');
  await setSetting('v2_smart_cleanup_done', '1');
  return imported;
}

/**
 * Cleans up historical V1 anomalies directly on an existing SQLite ledger:
 *  - deletes phantom "View" / self-name DEBIT notifications paired with SMS CREDITs
 *  - collapses same-day duplicate Spotify Autopay notifications & duplicate SMS credits
 *  - excludes FASTag ₹70 blind tolls and ₹1-2 verification pings
 *  - promotes investments (`Invest`, `Olectra greente`, `JPL`, `GCP`) to `Investment`
 *    and enforces `counterparty = 'Invest'`
 *  - repairs misclassified rows (e.g. from the `'cred'` substring bug) and applies
 *    client rules (such as `Pills N More` -> `Food & Drink`)
 */
export async function runSmartLedgerCleanup(force = false): Promise<number> {
  if (!force) {
    const done = await getSetting('v2_2_smart_cleanup_done');
    if (done === '1') {
      return 0;
    }
  }

  const connection = db();
  let affected = 0;

  // 1. Delete phantom notification DEBITs matching a verified SMS CREDIT within 3 minutes
  const delPhantom = await connection.execute(
    `DELETE FROM transactions
      WHERE direction = 'DEBIT'
        AND upi_ref IS NULL
        AND source = 'notification'
        AND (
          LOWER(TRIM(COALESCE(counterparty, ''))) = 'view'
          OR LOWER(TRIM(COALESCE(counterparty, ''))) LIKE '%pratham%'
        )
        AND EXISTS (
          SELECT 1 FROM transactions c
           WHERE c.direction = 'CREDIT'
             AND c.source IN ('sms', 'sms-import')
             AND ABS(c.amount - transactions.amount) < 0.01
             AND ABS(c.occurred_at - transactions.occurred_at) <= 180000
        )`,
  );
  affected += delPhantom.rowsAffected ?? 0;

  // 2. Delete duplicate same-day Spotify Autopay notifications without UPI ref
  const delSpotify = await connection.execute(
    `DELETE FROM transactions
      WHERE LOWER(COALESCE(counterparty, '')) LIKE '%spotify%'
        AND upi_ref IS NULL
        AND id NOT IN (
          SELECT MIN(id) FROM transactions
           WHERE LOWER(COALESCE(counterparty, '')) LIKE '%spotify%'
             AND upi_ref IS NULL
           GROUP BY strftime('%Y-%m-%d', occurred_at / 1000, 'unixepoch', 'localtime'), ROUND(amount, 2)
        )`,
  );
  affected += delSpotify.rowsAffected ?? 0;

  await connection.execute(
    `UPDATE transactions SET counterparty = 'Spotify'
      WHERE LOWER(COALESCE(counterparty, '')) LIKE '%spotify india%'`,
  );

  // 3. Delete duplicate SMS CREDIT within 5 minutes lacking account_tail when a richer CREDIT exists
  const delDupSms = await connection.execute(
    `DELETE FROM transactions
      WHERE direction = 'CREDIT'
        AND account_tail IS NULL
        AND TRIM(COALESCE(counterparty, '')) = ''
        AND EXISTS (
          SELECT 1 FROM transactions c
           WHERE c.id <> transactions.id
             AND c.direction = 'CREDIT'
             AND c.account_tail IS NOT NULL
             AND ABS(c.amount - transactions.amount) < 0.01
             AND ABS(c.occurred_at - transactions.occurred_at) <= 300000
        )`,
  );
  affected += delDupSms.rowsAffected ?? 0;

  // 4. Clear bogus View / SMS-sender counterparties
  const clearBogus = await connection.execute(
    `UPDATE transactions
        SET counterparty = NULL,
            category = CASE WHEN direction = 'CREDIT' AND category = 'Other' THEN 'Income' ELSE category END
      WHERE LOWER(TRIM(COALESCE(counterparty, ''))) IN ('view', 'ad-icicit-s', 'ax-icicit-s')`,
  );
  affected += clearBogus.rowsAffected ?? 0;

  // 5. Auto-exclude FASTag blind ₹70 tolls & <= ₹2 verification pings
  const exclNoise = await connection.execute(
    `UPDATE transactions SET excluded = 1
      WHERE excluded = 0
        AND (
          (direction = 'DEBIT' AND ABS(amount - 70) < 0.01 AND category = 'Travel'
           AND payment_mode = 'UPI' AND counterparty IS NULL AND upi_ref IS NULL AND account_tail IS NULL)
          OR (amount <= 2 AND (
            LOWER(COALESCE(counterparty, '')) LIKE '%google workspac%'
            OR LOWER(COALESCE(counterparty, '')) LIKE '%pratham%'
            OR category = 'Other'
            OR instrument = 'BANK'
            OR upi_ref LIKE '104%'
            OR upi_ref LIKE '111%'
            OR upi_ref LIKE '893%'
          ))
        )`,
  );
  affected += exclNoise.rowsAffected ?? 0;

  // 6. Upgrade Investment transactions to first-class Investment category with counterparty = 'Invest'
  const upgInvest = await connection.execute(
    `UPDATE transactions
        SET note = CASE
              WHEN (note IS NULL OR TRIM(note) = '')
                   AND counterparty IS NOT NULL
                   AND LOWER(TRIM(counterparty)) <> 'invest'
              THEN TRIM(counterparty)
              ELSE note
            END,
            counterparty = 'Invest',
            category = 'Investment',
            direction = 'DEBIT',
            category_locked = 1
      WHERE category = 'Investment'
         OR LOWER(TRIM(COALESCE(counterparty, ''))) = 'invest'
         OR LOWER(TRIM(COALESCE(note, ''))) IN ('invest', 'olectra greente', 'gcp', 'jpl')`,
  );
  affected += upgInvest.rowsAffected ?? 0;

  // 7. Re-classify using forever rules & updated keyword rules
  const rules = await listCategoryRules();
  const candidates = await connection.execute(
    `SELECT id, counterparty, raw_text, note, direction, category
       FROM transactions`,
  );

  for (const row of candidates.rows) {
    const cp = nstr(row.counterparty);
    const note = nstr(row.note);
    const dir = str(row.direction, 'DEBIT') as Direction;
    const oldCat = str(row.category, UNCATEGORISED);
    const classified = classifyTransaction({
      counterparty: cp,
      rawText: nstr(row.raw_text),
      direction: dir,
      userRules: rules,
      note,
    });
    const shouldUpdateCat =
      classified.matchedRule ||
      oldCat === 'Other' ||
      oldCat === 'Transfer' ||
      oldCat === 'Bills & Utilities' ||
      oldCat === 'Health';

    if (
      shouldUpdateCat &&
      classified.category !== UNCATEGORISED &&
      (classified.category !== oldCat || classified.counterparty !== cp) &&
      !(oldCat === 'Entertainment' && note?.toLowerCase().includes('kurta'))
    ) {
      await connection.execute(
        'UPDATE transactions SET category = ?, counterparty = ?, note = COALESCE(note, ?) WHERE id = ?',
        [classified.category, classified.counterparty, classified.note, num(row.id)],
      );
      affected += 1;
    }
  }

  await setSetting('v2_2_smart_cleanup_done', '1');
  return affected;
}

// ---------------------------------------------------------------------------
// export
// ---------------------------------------------------------------------------

function csvCell(value: string | number | null): string {
  if (value === null) {
    return '';
  }
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function exportCsv(): Promise<string> {
  const rows = await listTransactions({limit: 100_000});
  const header = [
    'date',
    'time',
    'amount',
    'direction',
    'payment_mode',
    'category',
    'counterparty',
    'upi_ref',
    'account_tail',
    'instrument',
    'source',
    'note',
    'excluded',
  ].join(',');

  const lines = rows.map(txn => {
    const date = new Date(txn.occurredAt);
    return [
      csvCell(dayKey(date)),
      csvCell(date.toTimeString().slice(0, 5)),
      csvCell(txn.amount.toFixed(2)),
      csvCell(txn.direction),
      csvCell(txn.paymentMode),
      csvCell(txn.category),
      csvCell(txn.counterparty),
      csvCell(txn.upiRef),
      csvCell(txn.accountTail),
      csvCell(txn.instrument),
      csvCell(txn.source),
      csvCell(txn.note),
      csvCell(txn.excluded ? 'yes' : 'no'),
    ].join(',');
  });

  return [header, ...lines].join('\n');
}

export async function exportJson(): Promise<string> {
  const rows = await listTransactions({limit: 100_000});
  return JSON.stringify(
    {
      app: 'ExpenseTracker',
      exportedAt: new Date().toISOString(),
      count: rows.length,
      transactions: rows,
    },
    null,
    2,
  );
}

/**
 * Wipes every table. Exposed through Settings > Delete all data; there is no
 * backup anywhere else, so the UI confirms before calling this.
 */
export async function resetAllData(): Promise<void> {
  const connection = db();
  await connection.execute('DELETE FROM transactions');
  await connection.execute('DELETE FROM ignored_messages');
  await connection.execute('DELETE FROM seen_messages');
  await connection.execute('DELETE FROM category_rules');
  await connection.execute('DELETE FROM settings');
  await connection.execute('VACUUM');
}
