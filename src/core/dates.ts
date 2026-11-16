/**
 * Local-time date helpers. All ranges are inclusive millisecond bounds so they
 * can be dropped straight into `BETWEEN ? AND ?`.
 *
 * Month keys are "YYYY-MM" and day keys "YYYY-MM-DD", both computed from local
 * time (not UTC) and in the same format the Kotlin widget uses, so the totals
 * pushed across the bridge line up with what the widget computes for itself.
 */
export interface Range {
  from: number;
  to: number;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function monthKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

export function dayKey(date: Date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function monthKeyToDate(key: string): Date {
  const [year, month] = key.split('-').map(Number);
  return new Date(year, (month ?? 1) - 1, 1);
}

export function monthRange(key: string): Range {
  const start = monthKeyToDate(key);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  return {from: start.getTime(), to: end.getTime() - 1};
}

export function dayRange(date: Date = new Date()): Range {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return {from: start.getTime(), to: start.getTime() + 86_400_000 - 1};
}

/** Rolling N-day window ending today (inclusive). */
export function trailingDaysRange(days: number, from: Date = new Date()): Range {
  const end = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 23, 59, 59, 999);
  const start = new Date(
    from.getFullYear(),
    from.getMonth(),
    from.getDate() - Math.max(0, days - 1),
    0,
    0,
    0,
    0,
  );
  return {from: start.getTime(), to: end.getTime()};
}

/** Parses YYYY-MM-DD start and end strings into a local-time inclusive Range. */
export function parseCustomDateRange(fromStr: string, toStr: string): Range | null {
  const cleanFrom = fromStr.trim();
  const cleanTo = toStr.trim();
  const re = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
  const m1 = re.exec(cleanFrom);
  const m2 = re.exec(cleanTo);
  if (!m1 || !m2) {
    return null;
  }
  const start = new Date(Number(m1[1]), Number(m1[2]) - 1, Number(m1[3]), 0, 0, 0, 0);
  const end = new Date(Number(m2[1]), Number(m2[2]) - 1, Number(m2[3]), 23, 59, 59, 999);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return null;
  }
  if (start.getTime() > end.getTime()) {
    return {from: end.getTime() - 86_400_000 + 1, to: start.getTime() + 86_400_000 - 1};
  }
  return {from: start.getTime(), to: end.getTime()};
}

/** Monday-start week containing `date`, matching the widget's Kotlin week logic. */
export function weekRange(date: Date = new Date()): Range {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const isoDay = (start.getDay() + 6) % 7; // Mon=0 ... Sun=6
  start.setDate(start.getDate() - isoDay);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  return {from: start.getTime(), to: end.getTime() - 1};
}

/** "YYYY-Www" ISO-ish week key, local time. Used to detect a stale widget baseline. */
export function weekKey(date: Date = new Date()): string {
  const {from} = weekRange(date);
  const start = new Date(from);
  return `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
}

/** Range covering the last `count` months, including the current one. */
export function trailingMonthsRange(count: number, from: Date = new Date()): Range {
  const start = new Date(from.getFullYear(), from.getMonth() - (count - 1), 1);
  const end = new Date(from.getFullYear(), from.getMonth() + 1, 1);
  return {from: start.getTime(), to: end.getTime() - 1};
}

/** Month keys oldest-first, e.g. for a 12 month trend chart. */
export function trailingMonthKeys(count: number, from: Date = new Date()): string[] {
  const keys: string[] = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    keys.push(monthKey(new Date(from.getFullYear(), from.getMonth() - offset, 1)));
  }
  return keys;
}

export function shiftMonthKey(key: string, delta: number): string {
  const date = monthKeyToDate(key);
  return monthKey(new Date(date.getFullYear(), date.getMonth() + delta, 1));
}

export function monthLabel(key: string): string {
  const date = monthKeyToDate(key);
  return `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;
}

export function monthLabelShort(key: string): string {
  const date = monthKeyToDate(key);
  return `${MONTH_SHORT[date.getMonth()]} ${String(date.getFullYear()).slice(2)}`;
}

export function isCurrentMonth(key: string): boolean {
  return key === monthKey();
}

/** "Today", "Yesterday", otherwise "Tue, 12 Mar". */
export function dayHeading(timestamp: number): string {
  const date = new Date(timestamp);
  const today = dayKey();
  const target = dayKey(date);
  if (target === today) {
    return 'Today';
  }
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (target === dayKey(yesterday)) {
    return 'Yesterday';
  }
  const suffix = date.getFullYear() === new Date().getFullYear() ? '' : ` ${date.getFullYear()}`;
  return `${DAY_SHORT[date.getDay()]}, ${date.getDate()} ${MONTH_SHORT[date.getMonth()]}${suffix}`;
}

export function timeLabel(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = date.getHours();
  const minutes = pad(date.getMinutes());
  const suffix = hours >= 12 ? 'pm' : 'am';
  const display = hours % 12 === 0 ? 12 : hours % 12;
  return `${display}:${minutes} ${suffix}`;
}

export function weekdayShort(timestamp: number): string {
  return DAY_SHORT[new Date(timestamp).getDay()];
}

/** How many days of the current month have elapsed (for daily averages). */
export function daysElapsedInMonth(key: string): number {
  const {from} = monthRange(key);
  const start = new Date(from);
  const now = new Date();
  if (monthKey(now) !== key) {
    return new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
  }
  return now.getDate();
}

export function daysInMonth(key: string): number {
  const date = monthKeyToDate(key);
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

export const DAY_MS = 86_400_000;
