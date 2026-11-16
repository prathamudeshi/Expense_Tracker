package com.expensetracker.capture

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import java.security.MessageDigest
import org.json.JSONArray
import org.json.JSONObject

/**
 * An append-only queue of raw captured text, owned by native code.
 *
 * Why a separate database from the app's main one: the notification listener and
 * SMS receiver run while the JS engine is dead, so they cannot write through
 * op-sqlite. They append here instead; JS drains the queue on launch/foreground,
 * runs the real parser, writes proper transactions, then marks rows consumed.
 *
 * Unconsumed rows also feed the widget's optimistic total (see WidgetRenderer).
 */
internal data class CaptureRow(
    val id: Long,
    val source: String,
    val origin: String,
    val title: String,
    val body: String,
    val postedAt: Long
)

private class CaptureDbHelper(context: Context) :
    SQLiteOpenHelper(context.applicationContext, "capture_queue.db", null, 1) {

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE captures (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source TEXT NOT NULL,
                origin TEXT NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                body TEXT NOT NULL DEFAULT '',
                posted_at INTEGER NOT NULL,
                hash TEXT NOT NULL UNIQUE,
                consumed INTEGER NOT NULL DEFAULT 0,
                quick_amount REAL,
                quick_direction TEXT
            )
            """.trimIndent()
        )
        db.execSQL("CREATE INDEX idx_captures_pending ON captures(consumed, posted_at)")
        db.execSQL(
            """
            CREATE TABLE discovered (
                package TEXT PRIMARY KEY,
                hits INTEGER NOT NULL DEFAULT 0,
                last_seen INTEGER NOT NULL,
                sample TEXT NOT NULL DEFAULT ''
            )
            """.trimIndent()
        )
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        db.execSQL("DROP TABLE IF EXISTS captures")
        db.execSQL("DROP TABLE IF EXISTS discovered")
        onCreate(db)
    }
}

internal object CaptureStore {

    private const val MAX_ROWS = 4000
    private const val CONSUMED_RETENTION_MS = 14L * 24 * 60 * 60 * 1000

    @Volatile
    private var helper: CaptureDbHelper? = null

    @Synchronized
    private fun db(context: Context): SQLiteDatabase {
        val existing = helper
        if (existing != null) return existing.writableDatabase
        val created = CaptureDbHelper(context)
        helper = created
        return created.writableDatabase
    }

    private fun sha1(input: String): String {
        val bytes = MessageDigest.getInstance("SHA-1").digest(input.toByteArray(Charsets.UTF_8))
        val sb = StringBuilder(bytes.size * 2)
        bytes.forEach { sb.append(String.format("%02x", it)) }
        return sb.toString()
    }

    /**
     * @return true when a new row was actually appended (false = duplicate).
     *
     * The hash buckets time into 5 minute windows so that a notification which
     * the posting app updates several times in a row only lands once. Two
     * genuinely identical payments inside the same window would collapse too,
     * which is why the TypeScript side ALSO de-duplicates using the UPI
     * reference number from the bank SMS.
     */
    fun enqueue(
        context: Context,
        source: String,
        origin: String,
        title: String,
        body: String,
        postedAt: Long
    ): Boolean {
        val text = listOf(title, body).filter { it.isNotBlank() }.joinToString(" ").trim()
        if (text.isEmpty()) return false

        val quick = QuickScan.scan(text)
        val hash = sha1("$source|$origin|${text.lowercase()}|${postedAt / 300_000L}")

        val values = ContentValues().apply {
            put("source", source)
            put("origin", origin)
            put("title", title)
            put("body", body)
            put("posted_at", postedAt)
            put("hash", hash)
            put("consumed", 0)
            if (quick != null) {
                put("quick_amount", quick.amount)
                put("quick_direction", quick.direction)
            }
        }

        val id = runCatching {
            db(context).insertWithOnConflict(
                "captures", null, values, SQLiteDatabase.CONFLICT_IGNORE
            )
        }.getOrDefault(-1L)

        if (id > 0) trim(context)
        return id > 0
    }

    fun pendingJson(context: Context, limit: Int): String {
        val out = JSONArray()
        readCursor(
            context,
            "SELECT id, source, origin, title, body, posted_at FROM captures " +
                "WHERE consumed = 0 ORDER BY posted_at ASC, id ASC LIMIT ?",
            arrayOf(limit.coerceIn(1, 2000).toString())
        ) { c ->
            out.put(
                JSONObject()
                    .put("id", c.getLong(0))
                    .put("source", c.getString(1))
                    .put("origin", c.getString(2))
                    .put("title", c.getString(3))
                    .put("body", c.getString(4))
                    .put("postedAt", c.getLong(5))
            )
        }
        return out.toString()
    }

    fun pendingCount(context: Context): Int = countQuery(
        context, "SELECT COUNT(*) FROM captures WHERE consumed = 0", emptyArray()
    )

    fun totalCount(context: Context): Int =
        countQuery(context, "SELECT COUNT(*) FROM captures", emptyArray())

    fun markConsumed(context: Context, idsJson: String): Int {
        val ids = runCatching {
            val arr = JSONArray(idsJson)
            (0 until arr.length()).mapNotNull { i ->
                val v = arr.opt(i)
                when (v) {
                    is Number -> v.toLong()
                    is String -> v.toLongOrNull()
                    else -> null
                }
            }
        }.getOrDefault(emptyList())

        if (ids.isEmpty()) return 0

        val placeholders = ids.joinToString(",") { "?" }
        val args = ids.map { it.toString() }.toTypedArray()
        return runCatching {
            val database = db(context)
            val cv = ContentValues().apply { put("consumed", 1) }
            database.update("captures", cv, "id IN ($placeholders)", args)
        }.getOrDefault(0)
    }

    /**
     * Sum of quick-scanned DEBIT amounts that JS has not yet processed, inside a
     * time range. Added on top of the authoritative total for the widget.
     */
    fun pendingDebitTotal(context: Context, fromMillis: Long, toMillis: Long): Double {
        var total = 0.0
        readCursor(
            context,
            "SELECT COALESCE(SUM(quick_amount), 0) FROM captures " +
                "WHERE consumed = 0 AND quick_direction = 'DEBIT' " +
                "AND quick_amount IS NOT NULL AND posted_at BETWEEN ? AND ?",
            arrayOf(fromMillis.toString(), toMillis.toString())
        ) { c -> total = c.getDouble(0) }
        return total
    }

    fun pendingDebitCount(context: Context, fromMillis: Long, toMillis: Long): Int = countQuery(
        context,
        "SELECT COUNT(*) FROM captures WHERE consumed = 0 AND quick_direction = 'DEBIT' " +
            "AND posted_at BETWEEN ? AND ?",
        arrayOf(fromMillis.toString(), toMillis.toString())
    )

    // ---- Discovery of payment apps we are not tracking yet ------------------

    fun recordDiscovery(context: Context, pkg: String, sample: String) {
        // Written as INSERT OR IGNORE + UPDATE rather than an UPSERT: SQLite's
        // ON CONFLICT ... DO UPDATE needs 3.24, which only ships from API 30,
        // and minSdk here is 24.
        runCatching {
            val database = db(context)
            val now = System.currentTimeMillis()
            val trimmed = if (sample.length > 160) sample.substring(0, 160) else sample
            database.execSQL(
                "INSERT OR IGNORE INTO discovered(package, hits, last_seen, sample) VALUES(?, 0, ?, ?)",
                arrayOf<Any>(pkg, now, trimmed)
            )
            database.execSQL(
                "UPDATE discovered SET hits = hits + 1, last_seen = ?, sample = ? WHERE package = ?",
                arrayOf<Any>(now, trimmed, pkg)
            )
        }
    }

    fun discoveredJson(context: Context): String {
        val out = JSONArray()
        readCursor(
            context,
            "SELECT package, hits, last_seen, sample FROM discovered ORDER BY hits DESC LIMIT 25",
            emptyArray()
        ) { c ->
            out.put(
                JSONObject()
                    .put("package", c.getString(0))
                    .put("label", CapturePrefs.appLabel(context, c.getString(0)))
                    .put("hits", c.getInt(1))
                    .put("lastSeen", c.getLong(2))
                    .put("sample", c.getString(3))
            )
        }
        return out.toString()
    }

    fun clearDiscovered(context: Context) {
        runCatching { db(context).delete("discovered", null, null) }
    }

    fun clearAll(context: Context) {
        runCatching {
            db(context).let {
                it.delete("captures", null, null)
                it.delete("discovered", null, null)
            }
        }
    }

    // ---- helpers -----------------------------------------------------------

    private fun trim(context: Context) {
        runCatching {
            val database = db(context)
            database.execSQL(
                "DELETE FROM captures WHERE consumed = 1 AND posted_at < ?",
                arrayOf<Any>(System.currentTimeMillis() - CONSUMED_RETENTION_MS)
            )
            database.execSQL(
                "DELETE FROM captures WHERE id NOT IN " +
                    "(SELECT id FROM captures ORDER BY id DESC LIMIT $MAX_ROWS)"
            )
        }
    }

    private inline fun readCursor(
        context: Context,
        sql: String,
        args: Array<String>,
        each: (Cursor) -> Unit
    ) {
        runCatching {
            db(context).rawQuery(sql, args).use { cursor ->
                while (cursor.moveToNext()) each(cursor)
            }
        }
    }

    private fun countQuery(context: Context, sql: String, args: Array<String>): Int {
        var result = 0
        readCursor(context, sql, args) { c -> result = c.getInt(0) }
        return result
    }
}
