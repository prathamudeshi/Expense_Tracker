package com.expensetracker.capture

import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.service.notification.NotificationListenerService
import com.expensetracker.widget.WidgetRenderer

/**
 * After a reboot or an app update Android sometimes does not re-bind a
 * notification listener until its app is opened. requestRebind() nudges it, so
 * capture resumes without the user having to launch the app.
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context?, intent: Intent?) {
        val ctx = context?.applicationContext ?: return
        val action = intent?.action ?: return

        if (action != Intent.ACTION_BOOT_COMPLETED &&
            action != Intent.ACTION_MY_PACKAGE_REPLACED &&
            action != "android.intent.action.QUICKBOOT_POWERON"
        ) {
            return
        }

        runCatching {
            NotificationListenerService.requestRebind(
                ComponentName(ctx, NotificationCaptureService::class.java)
            )
        }

        WidgetRenderer.refresh(ctx)
    }
}
