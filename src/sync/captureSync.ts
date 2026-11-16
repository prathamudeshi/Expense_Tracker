/**
 * Moves data from the native capture queue into the database, and pushes totals
 * back out to the home screen widget.
 *
 * Flow for one payment while the app is closed:
 *
 *   GPay notification -> NotificationCaptureService -> native queue (+ widget
 *   shows an optimistic total from QuickScan)
 *
 * Then when the app is next opened or foregrounded:
 *
 *   drainCaptures() -> real parser -> transactions table -> mark queue rows
 *   consumed -> pushWidgetTotals() writes the authoritative baseline
 *
 * Order matters: rows are only marked consumed *before* the new baseline is
 * pushed, so the widget never counts the same payment twice or drops it.
 */
import {
  markCapturesConsumed,
  pendingCaptures,
  pushWidgetSummary,
  readSmsInbox,
  refreshWidget,
} from '../native/capture';
import {ingestRawMessage, type IngestOutcome} from '../db/repository';
import {spendTotal, getNumberSetting, transactionCount} from '../db/repository';
import {dayKey, dayRange, monthKey, monthRange, weekKey, weekRange, DAY_MS} from '../core/dates';
import type {ModeFilter} from '../core/types';
import {SETTING_BUDGET} from '../state/settings';

export interface DrainResult {
  processed: number;
  inserted: number;
  merged: number;
  ignored: number;
  duplicate: number;
}

const EMPTY: DrainResult = {processed: 0, inserted: 0, merged: 0, ignored: 0, duplicate: 0};

function tally(result: DrainResult, outcome: IngestOutcome): void {
  result.processed += 1;
  if (outcome === 'inserted') {
    result.inserted += 1;
  } else if (outcome === 'merged') {
    result.merged += 1;
  } else if (outcome === 'ignored') {
    result.ignored += 1;
  } else {
    result.duplicate += 1;
  }
}

/** Drains everything the native side captured while we were not running. */
export async function drainCaptures(): Promise<DrainResult> {
  const captures = await pendingCaptures();
  if (captures.length === 0) {
    return {...EMPTY};
  }

  const result: DrainResult = {...EMPTY};
  const consumedIds: number[] = [];

  for (const capture of captures) {
    try {
      const outcome = await ingestRawMessage({
        source: capture.source,
        origin: capture.origin,
        title: capture.title,
        body: capture.body,
        postedAt: capture.postedAt,
      });
      tally(result, outcome);
      consumedIds.push(capture.id);
    } catch {
      // Leave the row unconsumed so the next drain retries it, but do not let
      // one bad message block the rest of the queue.
    }
  }

  if (consumedIds.length > 0) {
    await markCapturesConsumed(consumedIds);
  }

  return result;
}

export interface ImportResult extends DrainResult {
  scanned: number;
}

/**
 * One-off backfill from the SMS inbox so the app is useful immediately instead
 * of starting empty. Safe to run repeatedly - `seen_messages` makes re-imports
 * no-ops.
 */
export async function importSmsHistory(days: number): Promise<ImportResult> {
  const since = Date.now() - days * DAY_MS;
  const messages = await readSmsInbox(since);

  const result: ImportResult = {...EMPTY, scanned: messages.length};

  for (const message of messages) {
    try {
      const outcome = await ingestRawMessage({
        source: 'sms-import',
        origin: message.origin,
        body: message.body,
        postedAt: message.postedAt || Date.now(),
      });
      tally(result, outcome);
    } catch {
      // skip unparseable row
    }
  }

  await pushWidgetTotals();
  return result;
}

const WIDGET_PERIODS = [
  {key: 'today', range: dayRange},
  {key: 'week', range: weekRange},
  {key: 'month', range: () => monthRange(monthKey())},
] as const;

const WIDGET_MODES: Array<{key: string; mode: ModeFilter}> = [
  {key: 'all', mode: 'ALL'},
  {key: 'upi', mode: 'UPI'},
  {key: 'cash', mode: 'CASH'},
];

/**
 * Recomputes every period x mode combination the widget can show (Today/Week/
 * Month x Combined/UPI/Cash = 9 numbers) and hands them to the widget as its
 * new baseline. Native code then adds any not-yet-consumed captures on top
 * for whichever single cell is currently selected on screen.
 */
export async function pushWidgetTotals(): Promise<void> {
  const totals: Record<string, number> = {};

  await Promise.all(
    WIDGET_PERIODS.flatMap(period =>
      WIDGET_MODES.map(async ({key: modeKey, mode}) => {
        totals[`${period.key}:${modeKey}`] = await spendTotal(period.range(), mode);
      }),
    ),
  );

  const [budget, count] = await Promise.all([
    getNumberSetting(SETTING_BUDGET, 0),
    transactionCount(),
  ]);

  pushWidgetSummary({
    monthKey: monthKey(),
    weekKey: weekKey(),
    dayKey: dayKey(),
    budget,
    txnCount: count,
    totals,
  });
}

export function nudgeWidget(): void {
  refreshWidget();
}
