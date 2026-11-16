package com.expensetracker.widget

import android.content.Context
import org.json.JSONObject

/**
 * The authoritative totals, pushed here by JS every time the database changes.
 *
 * Kept in SharedPreferences rather than read from the app database because the
 * widget has to render while the JS engine is not running, and op-sqlite only
 * exists inside the JS runtime.
 *
 * The widget offers 3 periods (Today / Week / Month) x 3 modes (Combined / UPI
 * / Cash) = 9 numbers. Rather than model that as 9 separate keys, JS pushes one
 * flat map keyed "period:mode" (e.g. "month:upi") each time totals change. Native
 * code only ever reads the one cell the user currently has selected, and the
 * period/mode selection itself is stored separately so tapping a tab is a pure
 * SharedPreferences write + re-render, no JS round trip needed.
 */
internal data class WidgetSummary(
    val monthKey: String,
    val weekKey: String,
    val dayKey: String,
    val budget: Double,
    val txnCount: Int,
    /** "today:all" | "today:upi" | "today:cash" | "week:..." | "month:..." -> amount */
    val totals: Map<String, Double>,
    val updatedAt: Long
)

internal enum class WidgetPeriod(val key: String) { TODAY("today"), WEEK("week"), MONTH("month") }
internal enum class WidgetMode(val key: String) { ALL("all"), UPI("upi"), CASH("cash") }

internal object WidgetPrefs {

    private const val FILE = "expense_widget_prefs"
    private const val KEY_THEME_MODE = "theme_mode"
    private const val KEY_PERIOD = "selected_period"
    private const val KEY_MODE = "selected_mode"

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    /** "light" or "dark". Defaults to dark to match the app's own default. */
    fun themeMode(context: Context): String =
        prefs(context).getString(KEY_THEME_MODE, "dark") ?: "dark"

    fun setThemeMode(context: Context, mode: String) {
        val normalised = if (mode == "light") "light" else "dark"
        prefs(context).edit().putString(KEY_THEME_MODE, normalised).apply()
    }

    fun selectedPeriod(context: Context): WidgetPeriod {
        return when (prefs(context).getString(KEY_PERIOD, WidgetPeriod.MONTH.key)) {
            WidgetPeriod.TODAY.key -> WidgetPeriod.TODAY
            WidgetPeriod.WEEK.key -> WidgetPeriod.WEEK
            else -> WidgetPeriod.MONTH
        }
    }

    fun setSelectedPeriod(context: Context, period: WidgetPeriod) {
        prefs(context).edit().putString(KEY_PERIOD, period.key).apply()
    }

    fun selectedMode(context: Context): WidgetMode {
        return when (prefs(context).getString(KEY_MODE, WidgetMode.ALL.key)) {
            WidgetMode.UPI.key -> WidgetMode.UPI
            WidgetMode.CASH.key -> WidgetMode.CASH
            else -> WidgetMode.ALL
        }
    }

    fun setSelectedMode(context: Context, mode: WidgetMode) {
        prefs(context).edit().putString(KEY_MODE, mode.key).apply()
    }

    fun read(context: Context): WidgetSummary {
        val p = prefs(context)
        val totals = mutableMapOf<String, Double>()
        val rawTotals = p.getString("totals_json", null)
        if (rawTotals != null) {
            runCatching {
                val obj = JSONObject(rawTotals)
                obj.keys().forEach { key -> totals[key] = obj.optDouble(key, 0.0) }
            }
        }
        return WidgetSummary(
            monthKey = p.getString("month_key", "").orEmpty(),
            weekKey = p.getString("week_key", "").orEmpty(),
            dayKey = p.getString("day_key", "").orEmpty(),
            budget = p.getFloat("budget", 0f).toDouble(),
            txnCount = p.getInt("txn_count", 0),
            totals = totals,
            updatedAt = p.getLong("updated_at", 0L)
        )
    }

    fun write(context: Context, json: String) {
        runCatching {
            val obj = JSONObject(json)
            val totalsObj = obj.optJSONObject("totals") ?: JSONObject()
            prefs(context).edit()
                .putString("month_key", obj.optString("monthKey"))
                .putString("week_key", obj.optString("weekKey"))
                .putString("day_key", obj.optString("dayKey"))
                .putFloat("budget", obj.optDouble("budget", 0.0).toFloat())
                .putInt("txn_count", obj.optInt("txnCount", 0))
                .putString("totals_json", totalsObj.toString())
                .putLong("updated_at", System.currentTimeMillis())
                .apply()
        }
    }

    fun clear(context: Context) {
        prefs(context).edit().clear().apply()
    }
}
