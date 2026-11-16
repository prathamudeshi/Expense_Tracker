package com.expensetracker.capture

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.provider.Telephony
import org.json.JSONArray
import org.json.JSONObject

/**
 * One-off backfill. Reads the existing SMS inbox so the app can show history
 * from before it was installed, instead of starting from an empty screen.
 *
 * Returns the raw rows straight to JS - the shared parser decides what is a
 * payment and what is noise, and the ingest step de-duplicates against anything
 * already stored, so re-running an import is harmless.
 */
internal object SmsInboxReader {

    fun read(context: Context, sinceMillis: Long, limit: Int): String {
        if (context.checkSelfPermission(Manifest.permission.READ_SMS) != PackageManager.PERMISSION_GRANTED) {
            return JSONArray().toString()
        }

        val out = JSONArray()
        val projection = arrayOf(
            Telephony.Sms.ADDRESS,
            Telephony.Sms.BODY,
            Telephony.Sms.DATE
        )

        runCatching {
            context.contentResolver.query(
                Telephony.Sms.Inbox.CONTENT_URI,
                projection,
                Telephony.Sms.DATE + " >= ?",
                arrayOf(sinceMillis.coerceAtLeast(0).toString()),
                Telephony.Sms.DATE + " DESC LIMIT " + limit.coerceIn(1, 20000)
            )?.use { cursor ->
                val addressIdx = cursor.getColumnIndex(Telephony.Sms.ADDRESS)
                val bodyIdx = cursor.getColumnIndex(Telephony.Sms.BODY)
                val dateIdx = cursor.getColumnIndex(Telephony.Sms.DATE)
                while (cursor.moveToNext()) {
                    val body = if (bodyIdx >= 0) cursor.getString(bodyIdx).orEmpty() else ""
                    if (body.isBlank()) continue
                    out.put(
                        JSONObject()
                            .put("origin", if (addressIdx >= 0) cursor.getString(addressIdx).orEmpty() else "unknown")
                            .put("body", body)
                            .put("postedAt", if (dateIdx >= 0) cursor.getLong(dateIdx) else 0L)
                    )
                }
            }
        }

        return out.toString()
    }
}
