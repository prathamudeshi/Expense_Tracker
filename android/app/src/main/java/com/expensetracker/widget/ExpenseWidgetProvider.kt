package com.expensetracker.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build

class ExpenseWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        // Reads are a couple of tiny indexed SQLite queries plus SharedPreferences,
        // so doing this inline on the main thread is fine.
        runCatching {
            appWidgetManager.updateAppWidget(appWidgetIds, WidgetRenderer.build(context))
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        when (intent.action) {
            ACTION_REFRESH -> WidgetRenderer.refresh(context)
            ACTION_SET_PERIOD -> {
                val period = intent.getStringExtra(EXTRA_PERIOD)
                val resolved = WidgetPeriod.entries.firstOrNull { it.key == period }
                if (resolved != null) {
                    WidgetPrefs.setSelectedPeriod(context, resolved)
                    WidgetRenderer.refresh(context)
                }
            }
            ACTION_SET_MODE -> {
                val mode = intent.getStringExtra(EXTRA_MODE)
                val resolved = WidgetMode.entries.firstOrNull { it.key == mode }
                if (resolved != null) {
                    WidgetPrefs.setSelectedMode(context, resolved)
                    WidgetRenderer.refresh(context)
                }
            }
        }
    }

    companion object {
        const val ACTION_REFRESH = "com.expensetracker.action.WIDGET_REFRESH"
        const val ACTION_SET_PERIOD = "com.expensetracker.action.WIDGET_SET_PERIOD"
        const val ACTION_SET_MODE = "com.expensetracker.action.WIDGET_SET_MODE"
        const val EXTRA_PERIOD = "period"
        const val EXTRA_MODE = "mode"

        fun isPinned(context: Context): Boolean = runCatching {
            val manager = AppWidgetManager.getInstance(context) ?: return false
            val ids = manager.getAppWidgetIds(
                ComponentName(context.applicationContext, ExpenseWidgetProvider::class.java)
            )
            ids != null && ids.isNotEmpty()
        }.getOrDefault(false)

        /**
         * Asks the launcher to place the widget. Only some launchers support this;
         * returns false when unsupported so the UI can fall back to telling the
         * user to long-press the home screen.
         */
        fun requestPin(context: Context): Boolean {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
            return runCatching {
                val manager = AppWidgetManager.getInstance(context) ?: return false
                if (!manager.isRequestPinAppWidgetSupported) return false
                val provider = ComponentName(
                    context.applicationContext,
                    ExpenseWidgetProvider::class.java
                )
                val callback = PendingIntent.getBroadcast(
                    context,
                    3,
                    Intent(context, ExpenseWidgetProvider::class.java).apply {
                        action = ACTION_REFRESH
                    },
                    PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
                )
                manager.requestPinAppWidget(provider, null, callback)
            }.getOrDefault(false)
        }
    }
}
