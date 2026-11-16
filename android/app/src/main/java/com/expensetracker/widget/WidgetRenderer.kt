package com.expensetracker.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews
import com.expensetracker.MainActivity
import com.expensetracker.R
import com.expensetracker.capture.CaptureStore
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

/**
 * Builds and pushes the widget's RemoteViews.
 *
 * Two independent 3-way switches live on the widget: a period (Today / Week /
 * Month) and a mode (Combined / UPI / Cash). Both are simple tap targets wired
 * to PendingIntents that update a SharedPreferences selection and re-render -
 * RemoteViews has no real gesture support, so "tabs" here just means three
 * TextViews with click targets, not an actual TabLayout.
 *
 * Displayed total = authoritative total pushed from JS for the selected
 * period+mode, plus quick-scanned amounts of not-yet-consumed captures that
 * fall in the same window (Combined/UPI only - cash has no capture pipeline).
 * That second term is what keeps the widget correct when a payment happens
 * while the app is closed. Because JS only pushes a new baseline *after*
 * marking captures consumed, the two terms never overlap.
 */
internal object WidgetRenderer {

    private const val MAX_PROGRESS = 1000

    fun refresh(context: Context) {
        runCatching {
            val manager = AppWidgetManager.getInstance(context) ?: return
            val ids = manager.getAppWidgetIds(
                ComponentName(context.applicationContext, ExpenseWidgetProvider::class.java)
            )
            if (ids == null || ids.isEmpty()) return
            manager.updateAppWidget(ids, build(context))
        }
    }

    fun build(context: Context): RemoteViews {
        val app = context.applicationContext
        val theme = WidgetTheme.forMode(app, WidgetPrefs.themeMode(app))
        val summary = WidgetPrefs.read(app)
        val period = WidgetPrefs.selectedPeriod(app)
        val mode = WidgetPrefs.selectedMode(app)

        val now = Calendar.getInstance()
        val monthKey = SimpleDateFormat("yyyy-MM", Locale.US).format(now.time)
        val weekKey = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(startOfWeek(now).time)
        val dayKey = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(now.time)

        val views = RemoteViews(app.packageName, R.layout.widget_expense)

        applyTheme(views, theme)
        renderPeriodTabs(views, theme, period)
        renderModeTabs(views, theme, mode)

        val cell = "${period.key}:${mode.key}"
        // A baseline pushed for a different day/week/month than "now" is stale
        // (e.g. widget untouched since last month); treat it as zero rather
        // than showing an old number.
        val baselineFresh = when (period) {
            WidgetPeriod.TODAY -> summary.dayKey == dayKey
            WidgetPeriod.WEEK -> summary.weekKey == weekKey
            WidgetPeriod.MONTH -> summary.monthKey == monthKey
        }
        val baseline = if (baselineFresh) summary.totals[cell] ?: 0.0 else 0.0

        val range = rangeFor(period, now)
        // Cash has no capture pipeline - nothing pending to add on top of it.
        val pending = if (mode == WidgetMode.CASH) {
            0.0
        } else {
            CaptureStore.pendingDebitTotal(app, range.first, range.second)
        }
        val pendingCount = if (mode == WidgetMode.CASH) {
            0
        } else {
            CaptureStore.pendingDebitCount(app, range.first, range.second)
        }

        val total = baseline + pending

        views.setTextViewText(R.id.widget_label, periodLabel(period, now).uppercase(Locale.getDefault()))
        views.setTextViewText(R.id.widget_total, formatMoney(total))

        // The secondary line always shows Today, regardless of which period tab
        // is selected, so switching to Week/Month does not hide "how am I doing
        // today" - the number people check most often.
        val todayCell = "today:${mode.key}"
        val todayFresh = summary.dayKey == dayKey
        val todayBaseline = if (todayFresh) summary.totals[todayCell] ?: 0.0 else 0.0
        val todayRange = rangeFor(WidgetPeriod.TODAY, now)
        val todayPending = if (mode == WidgetMode.CASH) {
            0.0
        } else {
            CaptureStore.pendingDebitTotal(app, todayRange.first, todayRange.second)
        }
        views.setTextViewText(R.id.widget_today, "Today  " + formatMoney(todayBaseline + todayPending))

        // Budget progress only means something for Combined-Month; anything
        // else would compare unlike quantities (e.g. a week's spend against a
        // monthly budget).
        if (mode == WidgetMode.ALL && period == WidgetPeriod.MONTH && summary.budget > 0.0) {
            val ratio = (total / summary.budget).coerceIn(0.0, 1.0)
            views.setViewVisibility(R.id.widget_progress, View.VISIBLE)
            views.setViewVisibility(R.id.widget_budget, View.VISIBLE)
            views.setProgressBar(R.id.widget_progress, MAX_PROGRESS, (ratio * MAX_PROGRESS).toInt(), false)
            val pct = (total / summary.budget * 100.0).toInt()
            views.setTextViewText(R.id.widget_budget, "$pct% of " + formatMoney(summary.budget))
        } else {
            views.setViewVisibility(R.id.widget_progress, View.GONE)
            views.setViewVisibility(R.id.widget_budget, View.GONE)
        }

        views.setTextViewText(
            R.id.widget_footer,
            if (pendingCount > 0) {
                "$pendingCount new \u00B7 open app to categorise"
            } else {
                "Updated " + SimpleDateFormat("h:mm a", Locale.getDefault()).format(now.time)
            }
        )

        views.setOnClickPendingIntent(R.id.widget_root, openAppIntent(app))
        views.setOnClickPendingIntent(R.id.widget_refresh, refreshIntent(app))
        views.setOnClickPendingIntent(R.id.widget_tab_today, periodIntent(app, WidgetPeriod.TODAY))
        views.setOnClickPendingIntent(R.id.widget_tab_week, periodIntent(app, WidgetPeriod.WEEK))
        views.setOnClickPendingIntent(R.id.widget_tab_month, periodIntent(app, WidgetPeriod.MONTH))
        views.setOnClickPendingIntent(R.id.widget_tab_combined, modeIntent(app, WidgetMode.ALL))
        views.setOnClickPendingIntent(R.id.widget_tab_upi, modeIntent(app, WidgetMode.UPI))
        views.setOnClickPendingIntent(R.id.widget_tab_cash, modeIntent(app, WidgetMode.CASH))

        return views
    }

    // ---- theme ---------------------------------------------------------------

    private fun applyTheme(views: RemoteViews, theme: WidgetTheme) {
        views.setInt(R.id.widget_root, "setBackgroundResource", theme.background)
        views.setImageViewResource(R.id.widget_refresh, theme.refreshIcon)

        views.setTextColor(R.id.widget_label, theme.textDim)
        views.setTextColor(R.id.widget_total, theme.text)
        views.setTextColor(R.id.widget_today, theme.textDim)
        views.setTextColor(R.id.widget_budget, theme.textDim)
        views.setTextColor(R.id.widget_footer, theme.textFaint)
        views.setInt(R.id.widget_refresh, "setBackgroundResource", theme.iconBackground)
    }

    // ---- tabs ------------------------------------------------------------

    private fun renderPeriodTabs(views: RemoteViews, theme: WidgetTheme, selected: WidgetPeriod) {
        styleTab(views, R.id.widget_tab_today, theme, selected == WidgetPeriod.TODAY)
        styleTab(views, R.id.widget_tab_week, theme, selected == WidgetPeriod.WEEK)
        styleTab(views, R.id.widget_tab_month, theme, selected == WidgetPeriod.MONTH)
    }

    private fun renderModeTabs(views: RemoteViews, theme: WidgetTheme, selected: WidgetMode) {
        styleTab(views, R.id.widget_tab_combined, theme, selected == WidgetMode.ALL, small = true)
        styleTab(views, R.id.widget_tab_upi, theme, selected == WidgetMode.UPI, small = true)
        styleTab(views, R.id.widget_tab_cash, theme, selected == WidgetMode.CASH, small = true)
    }

    private fun styleTab(
        views: RemoteViews,
        id: Int,
        theme: WidgetTheme,
        active: Boolean,
        small: Boolean = false
    ) {
        views.setInt(id, "setBackgroundResource", if (active) theme.tabActiveBg else 0)
        views.setTextColor(id, if (active) theme.onAccent else if (small) theme.textFaint else theme.textDim)
    }

    // ---- intents -----------------------------------------------------------

    private fun openAppIntent(context: Context): PendingIntent {
        val intent = Intent(context, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        return PendingIntent.getActivity(
            context, 1, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun refreshIntent(context: Context): PendingIntent {
        val intent = Intent(context, ExpenseWidgetProvider::class.java).apply {
            action = ExpenseWidgetProvider.ACTION_REFRESH
        }
        return PendingIntent.getBroadcast(
            context, 2, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun periodIntent(context: Context, period: WidgetPeriod): PendingIntent {
        val intent = Intent(context, ExpenseWidgetProvider::class.java).apply {
            action = ExpenseWidgetProvider.ACTION_SET_PERIOD
            putExtra(ExpenseWidgetProvider.EXTRA_PERIOD, period.key)
        }
        // requestCode offset (10+) keeps these distinct from the mode intents below.
        return PendingIntent.getBroadcast(
            context, 10 + period.ordinal, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    private fun modeIntent(context: Context, mode: WidgetMode): PendingIntent {
        val intent = Intent(context, ExpenseWidgetProvider::class.java).apply {
            action = ExpenseWidgetProvider.ACTION_SET_MODE
            putExtra(ExpenseWidgetProvider.EXTRA_MODE, mode.key)
        }
        return PendingIntent.getBroadcast(
            context, 20 + mode.ordinal, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
    }

    // ---- date / range helpers ------------------------------------------------

    private fun periodLabel(period: WidgetPeriod, cal: Calendar): String = when (period) {
        WidgetPeriod.TODAY -> "TODAY"
        WidgetPeriod.WEEK -> "THIS WEEK"
        WidgetPeriod.MONTH -> SimpleDateFormat("MMMM yyyy", Locale.getDefault()).format(cal.time)
            .uppercase(Locale.getDefault())
    }

    /** Returns (fromMillis, toMillis) inclusive bounds for the given period. */
    private fun rangeFor(period: WidgetPeriod, now: Calendar): Pair<Long, Long> = when (period) {
        WidgetPeriod.TODAY -> {
            val start = startOfDay(now)
            start to start + 86_400_000L - 1
        }
        WidgetPeriod.WEEK -> {
            val start = startOfWeek(now).timeInMillis
            start to start + 7L * 86_400_000L - 1
        }
        WidgetPeriod.MONTH -> {
            startOfMonth(now) to endOfMonth(now)
        }
    }

    private fun startOfDay(source: Calendar): Long {
        val c = source.clone() as Calendar
        c.set(Calendar.HOUR_OF_DAY, 0)
        c.set(Calendar.MINUTE, 0)
        c.set(Calendar.SECOND, 0)
        c.set(Calendar.MILLISECOND, 0)
        return c.timeInMillis
    }

    /** Monday-start week, matching the TypeScript weekRange() helper. */
    private fun startOfWeek(source: Calendar): Calendar {
        val c = source.clone() as Calendar
        c.set(Calendar.HOUR_OF_DAY, 0)
        c.set(Calendar.MINUTE, 0)
        c.set(Calendar.SECOND, 0)
        c.set(Calendar.MILLISECOND, 0)
        // Calendar.DAY_OF_WEEK: Sunday=1 ... Saturday=7. Convert to Monday=0..Sunday=6.
        val isoDay = (c.get(Calendar.DAY_OF_WEEK) + 5) % 7
        c.add(Calendar.DAY_OF_MONTH, -isoDay)
        return c
    }

    private fun startOfMonth(source: Calendar): Long {
        val c = source.clone() as Calendar
        c.set(Calendar.DAY_OF_MONTH, 1)
        c.set(Calendar.HOUR_OF_DAY, 0)
        c.set(Calendar.MINUTE, 0)
        c.set(Calendar.SECOND, 0)
        c.set(Calendar.MILLISECOND, 0)
        return c.timeInMillis
    }

    private fun endOfMonth(source: Calendar): Long {
        val c = source.clone() as Calendar
        c.timeInMillis = startOfMonth(source)
        c.add(Calendar.MONTH, 1)
        return c.timeInMillis - 1
    }

    /**
     * Indian digit grouping (1,23,456) written by hand rather than via
     * DecimalFormat, which only supports one grouping size.
     */
    private fun formatMoney(value: Double): String {
        val rounded = Math.round(Math.abs(value))
        val grouped = groupIndian(rounded.toString())
        val sign = if (value < 0) "-" else ""
        return sign + "\u20B9" + grouped
    }

    private fun groupIndian(digits: String): String {
        if (digits.length <= 3) return digits
        val last3 = digits.substring(digits.length - 3)
        var rest = digits.substring(0, digits.length - 3)
        val sb = StringBuilder()
        while (rest.length > 2) {
            sb.insert(0, "," + rest.substring(rest.length - 2))
            rest = rest.substring(0, rest.length - 2)
        }
        if (rest.isNotEmpty()) sb.insert(0, rest)
        return sb.toString() + "," + last3
    }
}
