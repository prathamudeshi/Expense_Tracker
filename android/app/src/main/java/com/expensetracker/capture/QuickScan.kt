package com.expensetracker.capture

/**
 * A deliberately minimal amount/direction extractor.
 *
 * This is NOT the real parser - the authoritative one lives in TypeScript
 * (src/core/parser.ts) so it can be shared with iOS and iterated on quickly.
 * QuickScan exists for two narrow jobs that have to happen in native code:
 *
 *  1. Let the home screen widget show an up-to-date total while the JS engine
 *     is not running (app swiped away).
 *  2. Spot notifications from untracked apps that look like payment alerts, so
 *     Settings can suggest them to the user.
 *
 * Anything it gets slightly wrong is corrected the next time the app opens and
 * the real parser runs over the same raw text.
 */
internal data class QuickResult(val amount: Double, val direction: String)

internal object QuickScan {

    private val REJECT = listOf(
        "otp", "one time password", "one-time password",
        "is requesting", "has requested", "requesting money", "requested money",
        "payment request", "collect request",
        "will be debited", "will be credited", "will be deducted",
        "failed", "unsuccessful", "declined", "not processed", "timed out",
        "insufficient", "limit exceeded",
        "mandate created", "mandate registered", "e-mandate", "autopay",
        "amount due", "bill is due", "bill generated",
        "fastag", "netc fastag", "tag balance", "fastag wallet", "avail tag bal",
        "cashback", "reward", "scratch card", "voucher", "apply now", "pre-approved"
    )

    private val AMOUNT = Regex(
        "(?:\u20B9|rs\\.?|inr)\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)",
        RegexOption.IGNORE_CASE
    )

    private val AMOUNT_AFTER_VERB = Regex(
        "(?:debited|credited|paid|sent|spent)\\s*(?:by|of|for|with)?\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)",
        RegexOption.IGNORE_CASE
    )

    private val INCOMING_RE = Regex(
        "\\b(?:paid\\s+you|paid\\s+to\\s+you|sent\\s+you|sent\\s+to\\s+you|transferred\\s+to\\s+you|money\\s+received|received\\s+from|credited\\s+to\\s+(?:your\\s+)?(?:a/c|ac|acct|account))\\b",
        RegexOption.IGNORE_CASE
    )

    private val DEBIT_WORDS =
        listOf("debited", "you paid", "paid", "sent", "spent", "withdrawn", "payment of", "trf to", "transferred")

    private val CREDIT_WORDS = listOf("credited", "received", "refund", "deposited")

    /** Returns null when the text is clearly not a completed payment. */
    fun scan(text: String): QuickResult? {
        if (text.isBlank()) return null
        val lower = text.lowercase()
        if (REJECT.any { lower.contains(it) }) return null

        val raw = (AMOUNT.find(text) ?: AMOUNT_AFTER_VERB.find(text))
            ?.groupValues?.getOrNull(1) ?: return null
        val amount = raw.replace(",", "").toDoubleOrNull() ?: return null
        if (amount <= 0.0 || amount > 10_000_000.0) return null

        if (INCOMING_RE.containsMatchIn(lower)) {
            return QuickResult(amount, "CREDIT")
        }

        val sanitized = lower.replace(Regex("\\b(?:paid|sent|transferred)\\s+(?:to\\s+)?you\\b"), " ")
        val debitAt = DEBIT_WORDS.mapNotNull { w -> sanitized.indexOf(w).takeIf { it >= 0 } }.minOrNull()
        val creditAt = CREDIT_WORDS.mapNotNull { w -> lower.indexOf(w).takeIf { it >= 0 } }.minOrNull()

        val direction = when {
            debitAt != null && (creditAt == null || debitAt <= creditAt) -> "DEBIT"
            creditAt != null -> "CREDIT"
            else -> return null
        }
        return QuickResult(amount, direction)
    }

    /** Cheap "does this even mention money" test used for app discovery. */
    fun looksMonetary(text: String): Boolean = AMOUNT.containsMatchIn(text)
}
