# Expense Tracker — build, install and use

An Android expense tracker that records your GPay/UPI spending on its own, tracks
cash separately, stores everything in a local SQLite database, and shows spend
on a home screen widget with its own period and mode tabs.

React Native 0.87 + TypeScript, with a Kotlin native module for the parts Android
only exposes to native code.

---

## 1. How the automatic tracking works, and why

There is no API that will tell an app "this UPI payment just happened". So the
question is which side channel to read. Here is what's actually available on
Android, and why this app uses what it uses.

| Method | Verdict |
| --- | --- |
| **Notification listener** (`NotificationListenerService`) | **Primary.** GPay posts a notification for every completed payment, and a listener receives it the moment it's posted — before you can swipe it away. Works with the app closed. Catches payments even when your bank sends no SMS. |
| **Bank SMS** (`RECEIVE_SMS` / `READ_SMS`) | **Secondary.** Adds the two things notifications lack: the **UPI reference number** and the **masked account number**. Also the only way to backfill history from before you installed the app. |
| Accessibility service | **Rejected.** It works by reading everything on your screen. Enormous privacy and battery cost for data the notification already contains, and Google Play bans it for this use. |
| UPI / NPCI / Google Pay API | **Doesn't exist.** There is no public consumer transaction API. |
| RBI Account Aggregator | **Not available to individuals.** Requires registering as a licensed Financial Information User. |
| Gmail / statement parsing | **Rejected.** Arrives days late, so no live total and no widget. |

### Why both channels, and why that doesn't double-count

One payment normally generates **two** messages — a GPay notification and a bank
SMS — a few seconds apart. The app merges them into one transaction:

1. If both carry the same **UPI reference number**, they're the same payment, full stop.
2. Otherwise: same amount, same direction, within **4 minutes**, and **from different channels**.

That last condition matters. Without it, two genuinely separate ₹50 payments a
minute apart would collapse into one. Because a repeated message from the *same*
channel is already caught by fingerprinting, restricting the merge to
cross-channel matches is safe.

Merging **enriches**: the notification usually has the better merchant name, the
SMS has the reference number and account digits. You end up with one row holding
both.

### What runs when the app is closed

```
GPay payment
   ↓
NotificationCaptureService (always bound by Android)
   ↓
native SQLite queue  ──────────►  widget total updates immediately
   ↓                              (via a lightweight amount scan)
you open the app
   ↓
full TypeScript parser → transactions table → widget baseline rewritten
```

The widget stays current with the app killed because the native side does a
*rough* amount extraction for display only. When you next open the app the real
parser runs over the same raw text and the widget's number is replaced with the
authoritative one. Queue rows are marked consumed **before** the new baseline is
pushed, so nothing is ever counted twice or dropped.

### Privacy

No server, no account, no analytics, no network permission used for your data.
Everything lives in one SQLite file in the app's private storage. The notification
listener only stores text from the apps you tick in Settings; everything else is
discarded immediately.

### Cash is tracked too, but always by hand

There is no digital trail for cash, so it can only ever be logged manually with
the **+ Add transaction** button. What the app does for you: cash gets its own
`payment_mode`, kept completely separate from UPI in every total. Home, History
and Insights all have a **Combined / UPI / Cash** switch, so you can see "what did
I spend" (combined), "what did UPI pick up automatically" (UPI), or "what have I
logged by hand" (cash) without the two mixing.

When adding or editing a transaction, use the **Paid with** chip to mark it Cash
or UPI. Anything auto-captured from a notification or SMS is UPI by definition —
that chip only matters for manual entries.

---

## 2. Requirements

- **Node.js 22.11+** (`node -v`)
- **JDK 17**
- **Android SDK** with platform `android-37.0`, build-tools `37.0.0`, NDK `27.1.12297006`, CMake `3.22.1`
- An Android phone with USB debugging, or an emulator

If you have Android Studio, install the SDK pieces through
**Settings → Languages & Frameworks → Android SDK**. Otherwise, with
`cmdline-tools` installed:

```powershell
$env:ANDROID_HOME = "C:\Android"
& $env:ANDROID_HOME\cmdline-tools\latest\bin\sdkmanager.bat --licenses
& $env:ANDROID_HOME\cmdline-tools\latest\bin\sdkmanager.bat `
    "platforms;android-37.0" "build-tools;37.0.0" "platform-tools" `
    "ndk;27.1.12297006" "cmake;3.22.1"
```

> Note the platform is `android-37.0`, not `android-37` — Android moved to minor
> SDK versions and `sdkmanager` will say "Failed to find package" for the old name.

`android/local.properties` already points at `C:\Android`. Change it if your SDK
lives elsewhere.

---

## 3. Build and install

```powershell
npm install
```

### Option A — plug in a phone and run it

Enable **Developer options → USB debugging**, connect the phone, accept the
prompt, then:

```powershell
npx react-native run-android
```

This installs a debug build and starts Metro. Leave the Metro window open while
you use the app.

### Option B — build a standalone APK

```powershell
npm run apk
```

Output: `android/app/build/outputs/apk/release/app-release.apk`

Copy it to the phone and install it. This build bundles the JavaScript, so it
runs without Metro and without your computer — this is the one to use for daily
use.

> The release build is signed with the template's debug keystore. Fine for your
> own phone. Generate a real keystore if you ever distribute it.

Check it works:

```powershell
adb install -r android\app\build\outputs\apk\release\app-release.apk
adb logcat -s ReactNativeJS:V
```

---

## 4. First run — setup, in order

The app opens on **Home** with an orange "Setup needed" pill in the corner. Work
through the **Setup** tab top to bottom.

### Step 1 — Notification access (required)

Tap **Grant notification access**. Android opens its own permission screen —
this one cannot be granted from inside the app.

Find **Expense Tracker** in the list and turn it on, confirm the system warning,
then come back. The banner should turn into "Auto-tracking is active".

> If nothing is ever captured, this is the first thing to re-check. Some phones
> (Xiaomi, Realme, Oppo, Vivo) silently revoke notification access after a
> reboot or an app update.

### Step 2 — Bank SMS (recommended)

Leave the **Bank SMS** toggle on and tap **Allow SMS permission**. Grant both
prompts.

Skipping this still gives you working tracking — you just lose UPI reference
numbers, account digits, and the ability to import history.

### Step 3 — Pick the apps to watch

**Google Pay**, **Google Wallet** and **Google Messages** are on by default.
Turn off anything you don't use.

If you use a UPI or bank app that isn't listed, you don't need to hunt for its
package name. Make one payment with it, reopen this screen, and it appears under
**"Looks like a payment app"** — the listener noticed it posting an alert with an
amount in it. Tap **Add**. (There's also a manual package-name box.)

### Step 4 — Import your history

Under **Import past spending**, tap **Last 30 days**, **90 days** or **1 year**.
This reads bank alerts already sitting in your SMS inbox, so the app has data on
day one instead of an empty screen.

Re-running an import never creates duplicates — every raw message is
fingerprinted.

### Step 5 — Set a monthly budget

Type an amount and tap **Save**. Progress then shows on Home and on the widget.
Leave it empty to hide budget progress entirely.

### Step 6 — Add the widget

Tap **Add widget to home screen**. If your launcher doesn't support that, do it
the normal way: long-press an empty spot on the home screen → **Widgets** →
**Expense Tracker** → drag **Monthly spend** out. It's resizable.

The widget has two rows of tabs, since this is the piece of the app most people
actually check day to day:

- **Today / Week / Month** — which period the big number covers.
- **Combined / UPI / Cash** — which payment mode it covers. Cash only reflects
  what you've logged by hand in the app; UPI is everything auto-captured.

Tap a tab and the widget redraws immediately — no need to open the app. The
smaller "Today" line underneath always shows today's spend for whichever mode is
selected, regardless of which period tab is active, so you don't lose track of
today while looking at the week or month view. Budget progress only appears on
**Combined + Month**, since a budget compared against a single day or a single
mode is not a meaningful percentage.

The refresh icon forces a re-check without opening the app; the widget also
matches whichever **Dark/Light** appearance you picked in Setup (see Step 6a).

### Step 6a — Pick light or dark

Under **Setup → Appearance**, switch between **Dark** and **Light**. The whole
app repaints immediately, and the widget switches too — no need to remove and
re-add it.

### Step 7 — Stop Android from killing it

Under **Reliability**, if **Battery optimisation** shows **Fix**, tap it and set
Expense Tracker to **Unrestricted**. Aggressive battery managers are the most
common cause of missed payments.

---

## 5. Try it

1. Pay someone ₹1 on GPay (send it to yourself if you have a second UPI ID).
2. Watch the **widget** — the total goes up within a second or two, app closed.
3. Open the app. The payment is on Home under **Recent activity**, with a guessed category.
4. Tap it. Fix the category or payee if the guess was off; toggle **Exclude from totals** for things like self-transfers. Tap **Show original message** to see exactly what was captured.
5. Pull down on Home to force a sync.
6. Now try cash: tap **+ Add transaction**, enter an amount, leave **Paid with** on **Cash**, save. Switch the **Combined / UPI / Cash** control on Home to **Cash** — only that entry shows. Switch back to **Combined** and it's added into the total alongside the GPay payment from step 1.

Editing a category **locks** it — automatic categorisation will never overwrite
your choice.

---

## 6. The four tabs

Home, History and Insights all carry the same **Combined / UPI / Cash** switch
near the top - it scopes everything below it on that screen, including totals,
category breakdowns and budget progress.

**Home** — this month's spend, budget progress, per-day and projected totals,
top 5 categories, recent activity. `+ Add transaction` for cash or anything the
parser missed. Arrows move between months. In Combined mode, the hero card also
shows the UPI/Cash split underneath the total.

**History** — every transaction for a month, grouped by day with daily subtotals.
Search by merchant, category or amount. Filter to expenses or income, and by
payment mode. Tap any row to edit.

**Insights** — the long-term view, over 3 / 6 / 12 months or all time:
month-over-month trend (tap a bar to jump to that month), category mix, top
merchants, and which weekdays you spend most on. All computed on-device by SQLite,
scoped to whichever mode is selected.

**Setup** — everything from section 4, plus:
- **Appearance** — Dark/Light toggle, mirrored by the widget.
- **Unrecognised messages** — captured text the parser refused, with the reason. This is where to look if your bank's format isn't supported.
- **Export CSV / JSON** — shares the full history as text, including a `payment_mode` column.
- **Database file** — the exact path, with the `adb` command to pull a real backup.
- **Diagnostics** — permission states, queue depth, device info.
- **Delete all data**.

---

## 7. Your data, long term

Everything is in one SQLite file. Get the path from **Setup → Database file**;
it's normally:

```
/data/data/com.expensetracker/files/expenses.db
```

Back it up properly (debug builds only — release builds aren't `run-as`-able):

```powershell
adb shell run-as com.expensetracker cat /data/data/com.expensetracker/files/expenses.db > expenses.db
```

Then query it on your computer with any SQLite tool:

```sql
-- spend per month
SELECT strftime('%Y-%m', occurred_at/1000, 'unixepoch', 'localtime') AS month,
       ROUND(SUM(amount)) AS spent
FROM transactions
WHERE direction = 'DEBIT' AND excluded = 0
GROUP BY month ORDER BY month;

-- where the money actually goes
SELECT category, ROUND(SUM(amount)) AS spent, COUNT(*) AS payments
FROM transactions
WHERE direction = 'DEBIT' AND excluded = 0
GROUP BY category ORDER BY spent DESC;
```

The `transactions` table keeps `raw_text` for every auto-captured row, so you can
always audit where a number came from.

**Uninstalling the app deletes the database.** Export or pull the file first.
`allowBackup` is off deliberately — your payment history shouldn't sync to
Google's servers.

---

## 8. Troubleshooting

**Nothing is being captured**
1. Setup tab — is the banner green ("Auto-tracking is active")? If not, grant notification access.
2. Is the app you paid with ticked under **Apps to watch**?
3. Is **Battery optimisation** set to Unrestricted?
4. Check **Diagnostics → Queue total**. If it's 0, no notification ever reached the listener — it's a permission problem, not a parsing problem.
5. Reboot, then reopen the app once. Some OEMs don't rebind listeners until the app is launched.

**Payments captured but no transactions appear**
Queue total is going up but transactions aren't. Open **Unrecognised messages** —
your bank's wording probably isn't matched. Each entry shows the rejection reason
and the raw text; the patterns live in `src/core/parser.ts`.

**The widget total looks wrong**
Tap the refresh icon on the widget. If it's still off, open the app — that forces
a full recompute and rewrites the widget's baseline. A number that's slightly
high with the app closed is expected: it includes the rough native estimate for
payments not yet parsed, shown as "N new · open app to categorise".

**Amounts are right but merchants say "Unknown"**
Some banks send only `UPI/P2M/412345678901` with no payee name. If the GPay
notification for the same payment was captured it fills the name in. If GPay
wasn't running, edit the row once — the name sticks.

**Two rows for one payment**
The merge window is 4 minutes. If your bank's SMS arrives later than that and
carries no UPI reference, they won't be linked. Delete one and widen
`MERGE_WINDOW_MS` in `src/db/repository.ts` if it keeps happening.

**Build fails with `Plugin with id 'expo-module-gradle-plugin' not found`**
Already handled by `react-native.config.js`. `expo` ships with the RN 0.87
template for its dev tooling, and its autolinking check has a path bug that makes
it request native linking it doesn't need. Don't delete that file.

**Build fails with `Failed to find package 'platforms;android-37'`**
Install `platforms;android-37.0` — with the minor version.

**Build fails with `directory ".../prefab_package/debug/prefab" is not readable`**
A Gradle incremental-build cache bug affecting native modules that publish a
prefab package (`@op-engineering/op-sqlite` here) — the same failure is reported
against other libraries too, e.g.
[reanimated#7317](https://github.com/software-mansion/react-native-reanimated/issues/7317).
It shows up after a `clean` or on some cold builds. Fix:

```powershell
cd android
.\gradlew.bat assembleDebug --refresh-dependencies
```

You only need `--refresh-dependencies` once after it happens; subsequent builds
without the flag work again until the cache gets into that state a second time.

**Widget tabs don't respond to taps**
Long-press the widget and re-add it once after upgrading the app — Android
sometimes keeps rendering an old RemoteViews layout for a widget that was placed
before a layout change. A fresh add always picks up the current layout.

---

## 9. Where things live

```
specs/NativeExpenseCapture.ts     TurboModule contract (JS ⇄ Kotlin)
src/core/parser.ts                UPI/bank text → structured payment
src/core/categorize.ts            merchant keyword → category
src/db/repository.ts              all SQL; ingest, merge, analytics; mode filters
src/sync/captureSync.ts           native queue → database → widget (9 period×mode totals)
src/ui/theme.ts                   dark/light palettes
src/ui/themeContext.tsx           theme state, persisted + mirrored to the widget
src/screens/                      Home, History, Insights, Setup
android/.../capture/              notification listener, SMS receiver, queue
android/.../widget/               home screen widget (WidgetRenderer, WidgetTheme, WidgetPrefs)
```

To support a new bank format, add a pattern in `src/core/parser.ts` and paste the
raw text from **Unrecognised messages** to test against.

---

## 10. Two honest limitations

**Google Play would reject this.** `READ_SMS` and `RECEIVE_SMS` are restricted
permissions granted almost exclusively to default SMS handlers. That's irrelevant
for a personal sideloaded build, and notification capture alone doesn't need them
— but don't plan on publishing it.

**The parser is heuristic.** Indian banks and UPI apps have no standard wording,
so rules are the only option. It's built to fail loudly rather than silently:
anything it can't read goes to **Unrecognised messages** instead of being
guessed at or dropped.
