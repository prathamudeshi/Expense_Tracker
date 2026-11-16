/**
 * Local SQLite database. This is the single source of truth for the app and it
 * never leaves the device - there is no server, no account and no sync.
 *
 * SQLite (rather than AsyncStorage/JSON) specifically because the point of
 * keeping data long term is being able to ask questions of it: GROUP BY month,
 * GROUP BY category, trailing averages. Those stay fast with years of rows.
 */
import {open, type DB} from '@op-engineering/op-sqlite';

export const DB_NAME = 'expenses.db';

let handle: DB | null = null;

export function db(): DB {
  if (!handle) {
    throw new Error('Database not initialised - call initDatabase() first');
  }
  return handle;
}

/** Absolute path of the database file, shown in Settings so it can be backed up. */
export function databasePath(): string {
  try {
    return db().getDbPath();
  } catch {
    return DB_NAME;
  }
}

const MIGRATIONS: string[][] = [
  // v1 - initial schema
  [
    `CREATE TABLE IF NOT EXISTS transactions (
       id              INTEGER PRIMARY KEY AUTOINCREMENT,
       amount          REAL    NOT NULL,
       direction       TEXT    NOT NULL,
       category        TEXT    NOT NULL DEFAULT 'Other',
       counterparty    TEXT,
       vpa             TEXT,
       upi_ref         TEXT,
       account_tail    TEXT,
       instrument      TEXT,
       occurred_at     INTEGER NOT NULL,
       created_at      INTEGER NOT NULL,
       source          TEXT    NOT NULL,
       origin          TEXT,
       note            TEXT,
       excluded        INTEGER NOT NULL DEFAULT 0,
       category_locked INTEGER NOT NULL DEFAULT 0,
       raw_text        TEXT
     )`,
    `CREATE INDEX IF NOT EXISTS idx_txn_occurred ON transactions(occurred_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_txn_ref ON transactions(upi_ref)`,
    `CREATE INDEX IF NOT EXISTS idx_txn_dir_time ON transactions(direction, excluded, occurred_at)`,
    `CREATE INDEX IF NOT EXISTS idx_txn_category ON transactions(category)`,

    // Raw messages the parser could not use. Surfaced in Settings so unknown
    // bank formats are visible instead of silently dropped.
    `CREATE TABLE IF NOT EXISTS ignored_messages (
       id          INTEGER PRIMARY KEY AUTOINCREMENT,
       source      TEXT    NOT NULL,
       origin      TEXT    NOT NULL,
       body        TEXT    NOT NULL,
       received_at INTEGER NOT NULL,
       reason      TEXT    NOT NULL
     )`,
    `CREATE INDEX IF NOT EXISTS idx_ignored_time ON ignored_messages(received_at DESC)`,

    // Fingerprints of every raw message already processed, so re-running an SMS
    // import or re-draining the queue cannot create duplicates.
    `CREATE TABLE IF NOT EXISTS seen_messages (
       hash    TEXT PRIMARY KEY,
       seen_at INTEGER NOT NULL
     )`,

    `CREATE TABLE IF NOT EXISTS settings (
       key   TEXT PRIMARY KEY,
       value TEXT NOT NULL
     )`,

    // User-defined "if the text contains X, category is Y" rules.
    `CREATE TABLE IF NOT EXISTS category_rules (
       id       INTEGER PRIMARY KEY AUTOINCREMENT,
       keyword  TEXT NOT NULL UNIQUE,
       category TEXT NOT NULL
     )`,
  ],

  // v2 - cash as a first-class payment mode, tracked separately from UPI.
  // Every auto-captured row is necessarily UPI (nothing else can post a GPay
  // notification or bank SMS); existing rows backfill to 'UPI' accordingly.
  [
    `ALTER TABLE transactions ADD COLUMN payment_mode TEXT NOT NULL DEFAULT 'UPI'`,
    `UPDATE transactions SET payment_mode = 'UPI' WHERE payment_mode IS NULL OR payment_mode = ''`,
    `CREATE INDEX IF NOT EXISTS idx_txn_mode_time ON transactions(payment_mode, direction, excluded, occurred_at)`,
  ],

  // v3 - composite index for separating living spend from Investment rows quickly.
  [
    `CREATE INDEX IF NOT EXISTS idx_txn_cat_dir ON transactions(category, direction, excluded, occurred_at)`,
  ],

  // v4 - multi-account index and extended client classification rules (forever rules).
  [
    `CREATE INDEX IF NOT EXISTS idx_txn_account ON transactions(account_tail, occurred_at)`,
    `ALTER TABLE category_rules ADD COLUMN counterparty_override TEXT`,
    `ALTER TABLE category_rules ADD COLUMN default_note TEXT`,
    `ALTER TABLE category_rules ADD COLUMN auto_exclude INTEGER NOT NULL DEFAULT 0`,
  ],
];

export async function initDatabase(): Promise<void> {
  if (handle) {
    return;
  }

  handle = open({name: DB_NAME});

  // WAL keeps reads fast while a write is in flight; foreign_keys for safety.
  await handle.execute('PRAGMA journal_mode = WAL');
  await handle.execute('PRAGMA foreign_keys = ON');

  const versionResult = await handle.execute('PRAGMA user_version');
  const currentVersion = Number(Object.values(versionResult.rows[0] ?? {})[0] ?? 0);

  for (let version = currentVersion; version < MIGRATIONS.length; version += 1) {
    const statements = MIGRATIONS[version];
    for (const statement of statements) {
      await handle.execute(statement);
    }
    // PRAGMA cannot be parameterised, and `version` is a loop integer.
    await handle.execute(`PRAGMA user_version = ${version + 1}`);
  }
}

/** Test/debug helper: drop everything and re-create the schema. */
export async function resetDatabase(): Promise<void> {
  const connection = db();
  await connection.execute('DELETE FROM transactions');
  await connection.execute('DELETE FROM ignored_messages');
  await connection.execute('DELETE FROM seen_messages');
  await connection.execute('DELETE FROM category_rules');
  await connection.execute("DELETE FROM settings WHERE key <> 'schema_note'");
  await connection.execute('VACUUM');
}
