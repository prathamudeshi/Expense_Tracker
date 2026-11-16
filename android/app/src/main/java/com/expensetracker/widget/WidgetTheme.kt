package com.expensetracker.widget

import android.content.Context
import androidx.core.content.ContextCompat
import com.expensetracker.R

/**
 * Resolved drawable/colour set for one theme mode. RemoteViews cannot read a
 * day/night resource qualifier the way a normal Activity view can (there is no
 * live Context style resolution for widgets), so both palettes are declared as
 * explicit resource ids and picked here based on the user's in-app toggle.
 */
internal data class WidgetTheme(
    val background: Int,
    val iconBackground: Int,
    val refreshIcon: Int,
    val progress: Int,
    val tabActiveBg: Int,
    val text: Int,
    val textDim: Int,
    val textFaint: Int,
    val onAccent: Int
) {
    companion object {
        fun forMode(context: Context, mode: String): WidgetTheme {
            val isLight = mode == "light"
            return WidgetTheme(
                background = if (isLight) R.drawable.widget_background_light else R.drawable.widget_background_dark,
                iconBackground = if (isLight) R.drawable.widget_icon_background_light else R.drawable.widget_icon_background_dark,
                refreshIcon = if (isLight) R.drawable.ic_widget_refresh_light else R.drawable.ic_widget_refresh_dark,
                progress = if (isLight) R.drawable.widget_progress_light else R.drawable.widget_progress_dark,
                tabActiveBg = if (isLight) R.drawable.widget_tab_active_light else R.drawable.widget_tab_active_dark,
                text = ContextCompat.getColor(context, if (isLight) R.color.widget_text_light else R.color.widget_text_dark),
                textDim = ContextCompat.getColor(context, if (isLight) R.color.widget_text_dim_light else R.color.widget_text_dim_dark),
                textFaint = ContextCompat.getColor(context, if (isLight) R.color.widget_text_faint_light else R.color.widget_text_faint_dark),
                onAccent = ContextCompat.getColor(context, if (isLight) R.color.widget_on_accent_light else R.color.widget_on_accent_dark)
            )
        }
    }
}

