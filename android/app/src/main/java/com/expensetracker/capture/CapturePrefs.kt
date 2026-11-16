package com.expensetracker.capture

import android.content.Context
import android.content.pm.PackageManager
import org.json.JSONArray
import org.json.JSONObject

/**
 * Small SharedPreferences wrapper. Lives in native code because the
 * NotificationListenerService and the SMS receiver need these settings while
 * the JS engine is not running.
 */
internal object CapturePrefs {

    private const val FILE = "expense_capture_prefs"
    private const val KEY_PACKAGES = "tracked_packages"
    private const val KEY_NOTIFICATIONS = "capture_notifications"
    private const val KEY_SMS = "capture_sms"

    /**
     * Package names we ship out of the box. The user can add anything else from
     * Settings (and the discovery list suggests candidates automatically), so
     * this list only has to cover the common cases.
     */
    val KNOWN_APPS: List<Pair<String, String>> = listOf(
        "com.google.android.apps.nbu.paisa.user" to "Google Pay",
        "com.google.android.apps.walletnfcrel" to "Google Wallet",
        "com.google.android.apps.messaging" to "Google Messages (bank alerts)",
        "com.phonepe.app" to "PhonePe",
        "net.one97.paytm" to "Paytm",
        "in.org.npci.upiapp" to "BHIM",
        "com.dreamplug.androidapp" to "CRED"
    )

    private val DEFAULT_PACKAGES = setOf(
        "com.google.android.apps.nbu.paisa.user",
        "com.google.android.apps.walletnfcrel",
        "com.google.android.apps.messaging"
    )

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    fun trackedPackages(context: Context): Set<String> {
        val stored = prefs(context).getString(KEY_PACKAGES, null) ?: return DEFAULT_PACKAGES
        return runCatching {
            val arr = JSONArray(stored)
            val out = mutableSetOf<String>()
            for (i in 0 until arr.length()) {
                arr.optString(i).takeIf { it.isNotBlank() }?.let(out::add)
            }
            out.toSet()
        }.getOrDefault(DEFAULT_PACKAGES)
    }

    fun trackedPackagesJson(context: Context): String =
        JSONArray(trackedPackages(context).sorted()).toString()

    fun setTrackedPackagesJson(context: Context, json: String) {
        val cleaned = runCatching {
            val arr = JSONArray(json)
            val out = JSONArray()
            for (i in 0 until arr.length()) {
                arr.optString(i).trim().takeIf { it.isNotBlank() }?.let(out::put)
            }
            out.toString()
        }.getOrDefault(JSONArray().toString())
        prefs(context).edit().putString(KEY_PACKAGES, cleaned).apply()
    }

    fun notificationsEnabled(context: Context): Boolean =
        prefs(context).getBoolean(KEY_NOTIFICATIONS, true)

    fun smsEnabled(context: Context): Boolean =
        prefs(context).getBoolean(KEY_SMS, true)

    fun setEnabled(context: Context, notifications: Boolean, sms: Boolean) {
        prefs(context).edit()
            .putBoolean(KEY_NOTIFICATIONS, notifications)
            .putBoolean(KEY_SMS, sms)
            .apply()
    }

    fun enabledJson(context: Context): String = JSONObject()
        .put("notifications", notificationsEnabled(context))
        .put("sms", smsEnabled(context))
        .toString()

    fun knownAppsJson(context: Context): String {
        val pm = context.packageManager
        val tracked = trackedPackages(context)
        val arr = JSONArray()
        KNOWN_APPS.forEach { (pkg, label) ->
            val installed = runCatching { pm.getPackageInfo(pkg, 0) != null }.getOrDefault(false)
            arr.put(
                JSONObject()
                    .put("package", pkg)
                    .put("label", label)
                    .put("installed", installed)
                    .put("tracked", tracked.contains(pkg))
            )
        }
        // Anything the user added by hand that is not in the known list.
        tracked.filter { pkg -> KNOWN_APPS.none { it.first == pkg } }.sorted().forEach { pkg ->
            val label = runCatching {
                pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
            }.getOrDefault(pkg)
            arr.put(
                JSONObject()
                    .put("package", pkg)
                    .put("label", label)
                    .put("installed", runCatching { pm.getPackageInfo(pkg, 0) != null }.getOrDefault(false))
                    .put("tracked", true)
            )
        }
        return arr.toString()
    }

    fun appLabel(context: Context, pkg: String): String = runCatching {
        val pm: PackageManager = context.packageManager
        pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
    }.getOrDefault(pkg)
}
