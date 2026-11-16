package com.expensetracker.capture

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import com.expensetracker.widget.WidgetRenderer

/**
 * The primary capture channel.
 *
 * Google Pay posts a notification for every completed UPI payment ("You paid
 * Rs.230.00 to ..."), and it does so before the user can dismiss it, so a
 * listener sees all of them. This runs whether or not the app is open.
 *
 * Note the system binds this service itself; we never start it. If the user
 * revokes notification access Android unbinds us and capture silently stops,
 * which is why Settings surfaces the grant state prominently.
 */
class NotificationCaptureService : NotificationListenerService() {

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        val notification = sbn ?: return
        val context = applicationContext ?: return

        if (!CapturePrefs.notificationsEnabled(context)) return

        val pkg = notification.packageName ?: return
        if (pkg == context.packageName) return

        val payload = notification.notification ?: return

        // Group summaries repeat the child text and would double-count.
        if ((payload.flags and Notification.FLAG_GROUP_SUMMARY) != 0) return

        val extras = payload.extras ?: return
        val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty().trim()
        val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString().orEmpty().trim()
        val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString().orEmpty().trim()

        val body = listOf(text, bigText)
            .filter { it.isNotBlank() }
            .distinct()
            .joinToString(" ")

        if (title.isBlank() && body.isBlank()) return

        val postedAt = if (notification.postTime > 0) notification.postTime else System.currentTimeMillis()

        if (!CapturePrefs.trackedPackages(context).contains(pkg)) {
            // Not tracked - but if it mentions an amount, remember the package so
            // Settings can offer it as a suggestion.
            val combined = "$title $body"
            if (QuickScan.scan(combined) != null || QuickScan.looksMonetary(combined)) {
                CaptureStore.recordDiscovery(context, pkg, combined)
            }
            return
        }

        val stored = CaptureStore.enqueue(
            context = context,
            source = "notification",
            origin = pkg,
            title = title,
            body = body,
            postedAt = postedAt
        )

        if (stored) WidgetRenderer.refresh(context)
    }

    override fun onListenerConnected() {
        super.onListenerConnected()
        applicationContext?.let { WidgetRenderer.refresh(it) }
    }
}
