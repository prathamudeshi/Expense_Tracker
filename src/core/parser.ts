/**
 * Turns raw UPI/bank alert text into a structured payment.
 *
 * This is a heuristic parser, not a spec-compliant one, because there is no
 * standard for these messages - every bank and every UPI app words them
 * differently. The strategy is therefore:
 *
 *   1. Throw away anything that is obviously not a completed debit/credit
 *      (OTPs, collect requests, "will be debited", failures, promos).
 *   2. Find the transaction amount, ignoring amounts that are actually
 *      balances ("Avl Bal Rs.12,000").
 *   3. Decide direction from whichever debit/credit verb appears first.
 *   4. Pull out the extras when present: counterparty, UPI ref, account tail.
 *
 * When it cannot be confident it returns `{ok: false, reason}` and the caller
 * stores the message in `ignored_messages` so the user can inspect it in
 * Settings > Unrecognised messages and report the pattern.
 */
import type {Direction, ParseInput, ParseResult, ParsedPayment} from './types';

const MAX_AMOUNT = 10_000_000;

/** Phrases that mean "this is not money leaving or entering the account". */
const REJECT: Array<{re: RegExp; reason: string}> = [
  {re: /\b(otp|one[\s-]?time password)\b/i, reason: 'otp'},
  {
    re: /\b(is requesting|has requested|requesting money|requested money|payment request|collect request|requesting you)\b/i,
    reason: 'collect-request',
  },
  {re: /\bwill be (debited|credited|deducted)\b/i, reason: 'future-debit'},
  {re: /\b(failed|unsuccessful|declined|not processed|timed out|could not be)\b/i, reason: 'failed'},
  {re: /\b(insufficient|limit exceeded)\b/i, reason: 'rejected-by-bank'},
  {re: /\b(mandate (created|registered)|e-?mandate|autopay (set|enabled))\b/i, reason: 'mandate-setup'},
  {re: /\b(amount due|bill is due|bill generated|due on|minimum due)\b/i, reason: 'bill-reminder'},
  {
    re: /\b(fastag|netc\s+fastag|tag\s+balance|fastag\s+wallet|avail(?:able)?\s+tag\s+bal)\b/i,
    reason: 'fastag-deduction',
  },
  {
    re: /\b(cashback|reward|scratch card|voucher|apply now|pre-?approved|you could win|congratulations)\b/i,
    reason: 'promo',
  },
  {re: /\b(requested to pay|pay now to)\b/i, reason: 'collect-request'},
];

/** Words that, when just before an amount, mean the amount is a balance. */
const BALANCE_CONTEXT = [
  'bal',
  'balance',
  'avl',
  'avbl',
  'available',
  'limit',
  'outstanding',
  'mrp',
];

const DEBIT_WORDS = [
  'debited',
  'debit',
  'you paid',
  'paid',
  'sent',
  'spent',
  'withdrawn',
  'withdrawal',
  'payment of',
  'transferred to',
  'trf to',
  'purchase',
];

const CREDIT_WORDS = [
  'credited',
  'credit',
  'received',
  'refund',
  'refunded',
  'reversed',
  'deposited',
  'added to',
  'paid you',
  'paid to you',
  'sent you',
  'sent to you',
  'transferred to you',
];

const INCOMING_PAYMENT_RE =
  /\b(paid\s+you|paid\s+to\s+you|sent\s+you|sent\s+to\s+you|transferred\s+to\s+you|money\s+received|received\s+from|credited\s+to\s+(?:your\s+)?(?:a\/c|ac|acct|account))\b/i;

const AMOUNT_PREFIXED = /(?:₹|rs\.?|inr)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi;
const AMOUNT_SUFFIXED = /([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(?:₹|rs\b|inr)/gi;
const AMOUNT_AFTER_VERB =
  /(?:debited|credited|paid|sent|spent|withdrawn)\s*(?:by|of|for|with)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/gi;

const UPI_REF =
  /(?:upi(?:\s*(?:ref|reference|rrn))?(?:\s*(?:no|number|id))?|ref(?:erence)?(?:\s*no)?|rrn|txn\s*(?:id|no)|transaction\s*(?:id|no))\s*[:.#-]?\s*([0-9]{9,22})/i;

const ACCOUNT_TAIL =
  /\b(?:a\/c|ac|acct|account|card)\b\s*(?:no\.?|number)?\s*[:\-]?\s*(?:x+|\*+)?\s*(\d{3,6})\b/i;

const TO_PATTERNS = [
  /[;.]\s*([A-Za-z0-9@._&' -]{2,50}?)\s+credited\b/i,
  /(?:paid|sent|transferred|trf|debited)\s+(?:to|towards|for)\s+(?:vpa\s+)?([^,;.\n]{2,60})/i,
  /\bUPI\/(?:P2[AM]\/)?\d+\/([A-Za-z0-9@._&' -]{2,40})/i,
  /([A-Za-z0-9@._&' -]{2,50}?)\s+autopay\s+payment\b/i,
  /\bto\s+(?:vpa\s+)?([A-Za-z0-9@._&' -]{2,60})/i,
];

const FROM_PATTERNS = [
  /(?:received|credited)\s+from\s+(?:vpa\s+)?([^,;.\n]{2,60})/i,
  /([A-Za-z0-9._&' -]{2,50}?)\s+(?:paid|sent|transferred)\s+(?:to\s+)?you\b/i,
  /\bfrom\s+(?:vpa\s+)?([A-Za-z0-9@._&' -]{2,60})/i,
];

/** Where a counterparty capture should be cut short. */
const NAME_STOP =
  /\b(?:on|ref|refno|rrn|upi|via|dated|date|a\/c|ac|acct|account|txn|transaction|info|bal|avl|avbl|call|sms|successful|success|credited|debited|paid|sent|using|from|your|id|rs|inr|autopay|payment|mandate|view|tap|open|details|history|click)\b/i;

const GENERIC_TITLES =
  /^(google pay|gpay|google wallet|google messages|messages|phonepe|paytm|bhim|payments|upi|notification)$/i;

const BOGUS_COUNTERPARTY =
  /^(vpa|upi|self|you|your|me|a\/c|ac|account|view|tap to view|open|details|check|pay|paid|received|payment|transfer|unknown)$/i;

const SMS_SENDER_HEADER = /^[a-z]{2}-[a-z0-9]{3,10}(?:-[a-z0-9]{1,3})?$/i;

interface AmountHit {
  value: number;
  index: number;
}

export function parsePayment(input: ParseInput): ParseResult {
  const title = (input.title ?? '').trim();
  const body = (input.body ?? '').trim();
  const text = [title, body].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

  if (text.length < 6) {
    return {ok: false, reason: 'too-short'};
  }

  const lower = text.toLowerCase();

  for (const rule of REJECT) {
    if (rule.re.test(text)) {
      return {ok: false, reason: rule.reason};
    }
  }

  // Marketing SMS almost always carries a link and no transaction markers.
  if (/https?:\/\//i.test(lower) && !/\b(upi|a\/c|acct|account|vpa|ref|rrn)\b/i.test(lower)) {
    return {ok: false, reason: 'promo-link'};
  }

  const hits = findAmounts(text, lower);
  if (hits.length === 0) {
    return {ok: false, reason: 'no-amount'};
  }

  const direction = findDirection(lower);
  if (direction === null) {
    return {ok: false, reason: 'no-direction'};
  }

  const verbIndex = directionIndex(lower, direction) ?? 0;
  const amount = nearest(hits, verbIndex).value;

  const vpaMatch = /\b([a-z0-9][a-z0-9._-]{1,48}@[a-z][a-z.]{1,20})\b/i.exec(text);
  const counterparty = findCounterparty(text, body, direction, title, vpaMatch?.[1] ?? null);

  const payment: ParsedPayment = {
    amount,
    direction,
    counterparty,
    vpa: vpaMatch?.[1] ?? null,
    upiRef: UPI_REF.exec(text)?.[1] ?? null,
    accountTail: ACCOUNT_TAIL.exec(text)?.[1] ?? null,
    instrument: findInstrument(lower),
  };

  return {ok: true, payment};
}

// ---------------------------------------------------------------------------

function findAmounts(text: string, lower: string): AmountHit[] {
  const hits: AmountHit[] = [];

  const collect = (pattern: RegExp, skipBalances: boolean) => {
    // Regexes are module level and /g, so reset before reuse.
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      if (skipBalances) {
        const context = lower.slice(Math.max(0, match.index - 28), match.index);
        if (BALANCE_CONTEXT.some(word => context.includes(word))) {
          continue;
        }
      }
      const value = Number(match[1].replace(/,/g, ''));
      if (Number.isFinite(value) && value > 0 && value <= MAX_AMOUNT) {
        hits.push({value, index: match.index});
      }
    }
  };

  collect(AMOUNT_PREFIXED, true);
  if (hits.length === 0) {
    collect(AMOUNT_SUFFIXED, true);
  }
  if (hits.length === 0) {
    // SBI style: "A/C X1234 debited by 500.0" - no currency marker at all.
    collect(AMOUNT_AFTER_VERB, true);
  }

  return hits;
}

function wordIndex(lower: string, word: string): number | null {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // \b so that "paid" does not match inside "postpaid".
  const match = new RegExp(`\\b${escaped}`, 'i').exec(lower);
  return match ? match.index : null;
}

function earliest(lower: string, words: string[]): number | null {
  let best: number | null = null;
  for (const word of words) {
    const at = wordIndex(lower, word);
    if (at !== null && (best === null || at < best)) {
      best = at;
    }
  }
  return best;
}

function findDirection(lower: string): Direction | null {
  // Some banks phrase an outgoing UPI payment as money being *credited to the
  // payee* while debited from you. Direction is DEBIT in that case.
  if (
    /credited to\s+(?:vpa\s+)?\S+@/i.test(lower) &&
    /from\s+(?:your\s+)?(?:a\/c|ac|acct|account)/i.test(lower)
  ) {
    return 'DEBIT';
  }

  // Incoming P2P / bank alerts like "Aarav paid you ₹50" or "credited to your A/c"
  // must be evaluated before bare DEBIT_WORDS ('paid', 'sent').
  if (INCOMING_PAYMENT_RE.test(lower)) {
    return 'CREDIT';
  }

  // Strip incoming phrases just in case before scanning bare debit verbs.
  const sanitized = lower.replace(/\b(?:paid|sent|transferred)\s+(?:to\s+)?you\b/gi, ' ');
  const debitAt = earliest(sanitized, DEBIT_WORDS);
  const creditAt = earliest(lower, CREDIT_WORDS);

  if (debitAt !== null && (creditAt === null || debitAt <= creditAt)) {
    return 'DEBIT';
  }
  if (creditAt !== null) {
    return 'CREDIT';
  }
  return null;
}

function directionIndex(lower: string, direction: Direction): number | null {
  return earliest(lower, direction === 'DEBIT' ? DEBIT_WORDS : CREDIT_WORDS);
}

function nearest(hits: AmountHit[], anchor: number): AmountHit {
  let best = hits[0];
  let bestDistance = Math.abs(hits[0].index - anchor);
  for (const hit of hits.slice(1)) {
    const distance = Math.abs(hit.index - anchor);
    if (distance < bestDistance) {
      best = hit;
      bestDistance = distance;
    }
  }
  return best;
}

function findCounterparty(
  text: string,
  body: string,
  direction: Direction,
  title: string,
  vpa: string | null,
): string | null {
  const patterns = direction === 'DEBIT' ? TO_PATTERNS : FROM_PATTERNS;

  // Try body first so a generic notification title (e.g. "Google Pay") is not
  // swept into a leading-name match, then fall back to combined text.
  const candidates = body && body !== text ? [body, text] : [text];
  for (const sourceText of candidates) {
    for (const pattern of patterns) {
      const captured = pattern.exec(sourceText)?.[1];
      const cleaned = captured ? cleanName(captured) : null;
      if (cleaned) {
        return cleaned.includes('@') ? prettifyVpa(cleaned) : cleaned;
      }
    }
  }

  // GPay often puts the merchant in the notification title and the amount in
  // the body ("Chai Point" / "₹40 • Paid").
  const fromTitle = cleanName(title);
  if (fromTitle && !GENERIC_TITLES.test(fromTitle) && !/[₹]|(\brs\b)|(\binr\b)/i.test(fromTitle)) {
    return fromTitle;
  }

  return vpa ? prettifyVpa(vpa) : null;
}

function cleanName(raw: string): string | null {
  let value = raw.trim();
  if (!value) {
    return null;
  }

  value = value
    .replace(/\b(?:autopay\s+payment\s+of|autopay|private\s+limited|pvt\.?\s*ltd\.?)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const stop = NAME_STOP.exec(value);
  if (stop) {
    if (stop.index === 0) {
      return null; // capture begins with a stop word, so it is junk
    }
    value = value.slice(0, stop.index);
  }

  value = value
    .replace(/^[\s\-_.,:;*#|'"]+/, '')
    .replace(/[\s\-_.,:;*#|'"]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (value.length < 2 || value.length > 60) {
    return null;
  }
  if (/^\d+$/.test(value)) {
    return null;
  }
  if (BOGUS_COUNTERPARTY.test(value) || GENERIC_TITLES.test(value) || SMS_SENDER_HEADER.test(value)) {
    return null;
  }

  return titleCase(value);
}

function prettifyVpa(vpa: string): string {
  const local = vpa.split('@')[0] ?? vpa;
  const pretty = local
    .replace(/[._-]+/g, ' ')
    .replace(/\d{6,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return pretty.length >= 2 ? titleCase(pretty) : local;
}

/** Bank messages are often SHOUTING or all lowercase; normalise those only. */
function titleCase(value: string): string {
  const isUniformCase = value === value.toUpperCase() || value === value.toLowerCase();
  if (!isUniformCase) {
    return value;
  }
  return value
    .split(' ')
    .map(word =>
      word.length <= 1 ? word.toUpperCase() : word[0].toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join(' ');
}

function findInstrument(lower: string): ParsedPayment['instrument'] {
  if (/\bupi\b|\bvpa\b|@[a-z]/i.test(lower)) {
    return 'UPI';
  }
  if (/\bcard\b/i.test(lower)) {
    return 'CARD';
  }
  if (/\bimps\b|\bneft\b|\brtgs\b|net\s?banking/i.test(lower)) {
    return 'BANK';
  }
  if (/\bwallet\b/i.test(lower)) {
    return 'WALLET';
  }
  return null;
}
