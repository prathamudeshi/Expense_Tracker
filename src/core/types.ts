export type Direction = 'DEBIT' | 'CREDIT';

export type TxnSource = 'notification' | 'sms' | 'sms-import' | 'manual';

/**
 * How the money moved. UPI is anything auto-captured or explicitly logged as
 * digital; CASH is always entered by hand, since there is no digital trail to
 * read. Kept as its own column (not inferred from `source`) so a manual entry
 * can be tagged UPI too - e.g. adding a payment the parser missed.
 */
export type PaymentMode = 'UPI' | 'CASH';

export type ModeFilter = PaymentMode | 'ALL';

/** 'ALL' = every account, 'UNLINKED' = no account tail, otherwise the tail digits (e.g. '911'). */
export type AccountFilter = string;

/** Result of parsing one raw notification / SMS. */
export interface ParsedPayment {
  amount: number;
  direction: Direction;
  /** Human readable merchant or person, best effort. */
  counterparty: string | null;
  /** UPI handle if one appeared in the text (e.g. someone@okaxis). */
  vpa: string | null;
  /** UPI reference / RRN. The strongest de-duplication key we get. */
  upiRef: string | null;
  /** Last 3-6 digits of the account or card. */
  accountTail: string | null;
  instrument: 'UPI' | 'CARD' | 'BANK' | 'WALLET' | null;
}

export interface ParseInput {
  source: TxnSource;
  /** Package name for notifications, sender id for SMS. */
  origin: string;
  title?: string;
  body: string;
}

export type ParseResult =
  | {ok: true; payment: ParsedPayment}
  | {ok: false; reason: string};

export interface Transaction {
  id: number;
  amount: number;
  direction: Direction;
  paymentMode: PaymentMode;
  category: string;
  counterparty: string | null;
  vpa: string | null;
  upiRef: string | null;
  accountTail: string | null;
  instrument: string | null;
  occurredAt: number;
  createdAt: number;
  source: TxnSource;
  origin: string | null;
  note: string | null;
  excluded: boolean;
  categoryLocked: boolean;
  rawText: string | null;
}

export interface RawCapture {
  id: number;
  source: 'notification' | 'sms';
  origin: string;
  title: string;
  body: string;
  postedAt: number;
}

export interface CategoryTotal {
  category: string;
  total: number;
  count: number;
}

export interface MonthTotal {
  monthKey: string;
  spend: number;
  invested: number;
  income: number;
  count: number;
}

export interface MerchantTotal {
  counterparty: string;
  total: number;
  count: number;
}

export interface PeriodSummary {
  spend: number;
  invested: number;
  investmentCount: number;
  income: number;
  count: number;
  largest: number;
  firstAt: number | null;
  lastAt: number | null;
  /** Spend split by mode, so UPI/Cash totals never need a second round trip. */
  upiSpend: number;
  cashSpend: number;
}

export interface InvestmentHolding {
  name: string;
  total: number;
  count: number;
  lastAt: number;
}

export interface PeerSplitItem {
  person: string;
  received: number;
  paid: number;
  net: number;
  count: number;
}

export interface HabitSpot {
  name: string;
  category: string;
  total: number;
  count: number;
  avgTicket: number;
}

export interface IncomeBreakdown {
  coreIncome: number;
  reboundRefunds: number;
  peerSplits: number;
}

export interface BankAccountSummary {
  accountTail: string;
  label: string;
  spend: number;
  invested: number;
  income: number;
  count: number;
}

export interface TimeSlotStat {
  key: string;
  label: string;
  window: string;
  spend: number;
  count: number;
}

export interface TicketTierStat {
  key: string;
  label: string;
  spend: number;
  count: number;
}

export interface AnalystBrief {
  id: string;
  title: string;
  detail: string;
  metric: string;
}

export interface InsightsDeepDive {
  timeSlots: TimeSlotStat[];
  ticketTiers: TicketTierStat[];
  activeDays: number;
  zeroSpendDays: number;
  totalDaysInPeriod: number;
  avgTicket: number;
  dailyBurnRate: number;
  projected30d: number;
  topOutliers: Transaction[];
  briefs: AnalystBrief[];
}

export interface IgnoredMessage {
  id: number;
  source: string;
  origin: string;
  body: string;
  receivedAt: number;
  reason: string;
}
