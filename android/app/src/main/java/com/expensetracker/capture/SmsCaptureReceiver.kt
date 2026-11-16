package com.expensetracker.capture

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import com.expensetracker.widget.WidgetRenderer

/**
 * The secondary capture channel.
 *
 * Bank debit SMS carries two things a GPay notification does not: the UPI
 * reference number and the masked account number. The TypeScript ingest step
 * merges an SMS into the matching notification-sourced transaction (same amount,
 * same direction, within a few minutes) instead of creating a second row, so
 * running both channels enriches the data rather than duplicating it.
 */
class SmsCaptureReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context?, intent: Intent?) {
        val ctx = context?.applicationContext ?: return
        if (intent?.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        if (!CapturePrefs.smsEnabled(ctx)) return

        val messages = runCatching { Telephony.Sms.Intents.getMessagesFromIntent(intent) }
            .getOrNull() ?: return
        if (messages.isEmpty()) return

        val first = messages[0] ?: return
        val sender = first.displayOriginatingAddress ?: first.originatingAddress ?: "unknown"

        // Long bank alerts arrive as multiple parts; stitch them back together.
        val body = messages.joinToString("") { it?.displayMessageBody.orEmpty() }
        if (body.isBlank()) return

        val timestamp = first.timestampMillis.takeIf { it > 0 } ?: System.currentTimeMillis()

        val stored = CaptureStore.enqueue(
            context = ctx,
            source = "sms",
            origin = sender,
            title = "",
            body = body,
            postedAt = timestamp
        )

        if (stored) WidgetRenderer.refresh(ctx)
    }
}
