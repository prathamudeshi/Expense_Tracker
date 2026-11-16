package com.expensetracker.capture

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import com.expensetracker.widget.ExpenseWidgetProvider
import com.expensetracker.widget.WidgetPrefs
import com.expensetracker.widget.WidgetRenderer
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import java.util.concurrent.Executors
import org.json.JSONObject

internal const val EXPENSE_CAPTURE_MODULE = "NativeExpenseCapture"

/**
 * Bridge between the shared TypeScript layer and the Android-only capture stack.
 *
 * Deliberately thin: it exposes settings, drains the native capture queue and
 * pushes widget totals. No parsing happens here.
 */
class ExpenseCaptureModule(reactContext: ReactApplicationContext) :
    NativeExpenseCaptureSpec(reactContext) {

    private val io = Executors.newSingleThreadExecutor()

    private val appContext: Context
        get() = reactApplicationContext.applicationContext

    override fun getName(): String = EXPENSE_CAPTURE_MODULE

    override fun isSupported(): Boolean = true

    // ---- Notification access ------------------------------------------------

    override fun isNotificationAccessGranted(): Boolean = runCatching {
        val flat = Settings.Secure.getString(
            appContext.contentResolver,
            "enabled_notification_listeners"
        ) ?: return false
        flat.split(":").any { entry ->
            ComponentName.unflattenFromString(entry)?.packageName == appContext.packageName
        }
    }.getOrDefault(false)

    override fun openNotificationAccessSettings() {
        val component = ComponentName(appContext, NotificationCaptureService::class.java)

        // Android 11+ can deep-link straight to this app's toggle.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val deepLink = Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS)
                .putExtra(
                    Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME,
                    component.flattenToString()
                )
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            if (launch(deepLink)) return
        }

        launch(
            Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    }

    // ---- Tracked apps -------------------------------------------------------

    override fun getKnownPaymentAppsJson(): String = CapturePrefs.knownAppsJson(appContext)

    override fun getTrackedPackagesJson(): String = CapturePrefs.trackedPackagesJson(appContext)

    override fun setTrackedPackagesJson(json: String) {
        CapturePrefs.setTrackedPackagesJson(appContext, json)
    }

    override fun getDiscoveredAppsJson(promise: Promise) {
        io.execute {
            runCatching { CaptureStore.discoveredJson(appContext) }
                .onSuccess(promise::resolve)
                .onFailure { promise.reject("discovery_failed", it) }
        }
    }

    override fun clearDiscoveredApps() {
        io.execute { CaptureStore.clearDiscovered(appContext) }
    }

    // ---- Channel toggles ----------------------------------------------------

    override fun setCaptureEnabled(notifications: Boolean, sms: Boolean) {
        CapturePrefs.setEnabled(appContext, notifications, sms)
    }

    override fun getCaptureEnabledJson(): String = CapturePrefs.enabledJson(appContext)

    // ---- Capture queue ------------------------------------------------------

    override fun getPendingCapturesJson(limit: Double, promise: Promise) {
        io.execute {
            runCatching { CaptureStore.pendingJson(appContext, limit.toInt()) }
                .onSuccess(promise::resolve)
                .onFailure { promise.reject("pending_failed", it) }
        }
    }

    override fun markCapturesConsumedJson(idsJson: String, promise: Promise) {
        io.execute {
            runCatching { CaptureStore.markConsumed(appContext, idsJson) }
                .onSuccess { promise.resolve(it.toDouble()) }
                .onFailure { promise.reject("consume_failed", it) }
        }
    }

    override fun getPendingCount(promise: Promise) {
        io.execute {
            runCatching { CaptureStore.pendingCount(appContext) }
                .onSuccess { promise.resolve(it.toDouble()) }
                .onFailure { promise.reject("count_failed", it) }
        }
    }

    // ---- SMS backfill -------------------------------------------------------

    override fun readSmsInboxJson(sinceMillis: Double, limit: Double, promise: Promise) {
        io.execute {
            runCatching { SmsInboxReader.read(appContext, sinceMillis.toLong(), limit.toInt()) }
                .onSuccess(promise::resolve)
                .onFailure { promise.reject("sms_read_failed", it) }
        }
    }

    // ---- Widget -------------------------------------------------------------

    override fun setWidgetSummaryJson(json: String) {
        WidgetPrefs.write(appContext, json)
        WidgetRenderer.refresh(appContext)
    }

    override fun refreshWidget() {
        WidgetRenderer.refresh(appContext)
    }

    override fun setThemeMode(mode: String) {
        WidgetPrefs.setThemeMode(appContext, mode)
        WidgetRenderer.refresh(appContext)
    }

    override fun isWidgetPinned(): Boolean = ExpenseWidgetProvider.isPinned(appContext)

    override fun requestPinWidget(promise: Promise) {
        runCatching { ExpenseWidgetProvider.requestPin(appContext) }
            .onSuccess(promise::resolve)
            .onFailure { promise.reject("pin_failed", it) }
    }

    // ---- Battery / diagnostics ---------------------------------------------

    override fun isIgnoringBatteryOptimizations(): Boolean = runCatching {
        val pm = appContext.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return false
        pm.isIgnoringBatteryOptimizations(appContext.packageName)
    }.getOrDefault(false)

    override fun openBatteryOptimizationSettings() {
        val listIntent = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (launch(listIntent)) return

        launch(
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                .setData(Uri.parse("package:" + appContext.packageName))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    }

    override fun getDiagnosticsJson(promise: Promise) {
        io.execute {
            runCatching {
                JSONObject()
                    .put("notificationAccess", isNotificationAccessGranted())
                    .put("notificationsEnabled", CapturePrefs.notificationsEnabled(appContext))
                    .put("smsEnabled", CapturePrefs.smsEnabled(appContext))
                    .put("trackedPackages", CapturePrefs.trackedPackages(appContext).size)
                    .put("queuePending", CaptureStore.pendingCount(appContext))
                    .put("queueTotal", CaptureStore.totalCount(appContext))
                    .put("widgetPinned", ExpenseWidgetProvider.isPinned(appContext))
                    .put("batteryUnrestricted", isIgnoringBatteryOptimizations())
                    .put("androidSdk", Build.VERSION.SDK_INT)
                    .put("device", Build.MANUFACTURER + " " + Build.MODEL)
                    .toString()
            }
                .onSuccess(promise::resolve)
                .onFailure { promise.reject("diagnostics_failed", it) }
        }
    }

    override fun invalidate() {
        io.shutdown()
        super.invalidate()
    }

    private fun launch(intent: Intent): Boolean = runCatching {
        appContext.startActivity(intent)
        true
    }.getOrDefault(false)
}
