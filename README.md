# Expense Tracker

Privacy-first Android expense & investment tracker built with **React Native 0.87 + TypeScript**, a **Kotlin TurboModule** for background notification/SMS capture, **local SQLite (`op-sqlite`)** storage, and a **native Android home screen widget**.

Everything runs 100% on-device — no server, no account, no cloud sync.

---

## Key Features (V2)

- **Monochromatic Dark-First UI**: Minimalistic `#080A0F` dark theme with a single Steel-Cobalt (`#5B8DEF`) tonal palette, subtle gradients, and clean geometric category symbols (no emojis).
- **Automatic UPI & Bank SMS Capture**:
  - Reads payment notifications (`NotificationListenerService`) and bank SMS (`RECEIVE_SMS` / `READ_SMS`) in the background, even when the app is closed.
  - Smart deduplication across channels and clients (UPI reference matching, 10-minute cross-origin merge window, 12-hour autopay guard, and phantom `"paid you"` / `"View"` / FASTag filtering).
- **First-Class Investment Tracking**:
  - Investments (`Invest`, Zerodha, Groww, Upstox, IPOs, SIPs) are standardized under `Invest` and separated from **Living Spend**, budgets, and widget totals.
- **Forever Client Rules**:
  - Built-in presets for common local merchants (e.g. `Pills N More`, `Hubble`, `Godrej One`, `Hair X Studio`) plus custom **forever rules** in **Setup** or the transaction editor that retroactively classify past and future payments.
- **Multi-Bank Account Tracking**:
  - Separately filter and inspect spending, investments, and inflows per bank account tail (e.g. `••911`) or `Cash / Unlinked`, with custom bank labels in **Setup**.
- **Insights Dashboard**:
  - Timelines: **`1D`**, **`1W`**, **`1M`**, **`3M`**, **`6M`**, **`1Y`**, **`All`**, and **`Custom`** date range.
  - Four focused lenses: **Overview** (Capital allocation, Velocity & Discipline, Smart Analyst briefs, Spend vs Invested trajectory, Bank accounts), **Spending** (Category mix, Time-of-day profile, Ticket-size tiers, Weekly rhythm, Top clients, Largest single spends), **Invest** (Portfolio deployed, Allocations & notes, Monthly deployment), and **Habits** (Frequent clients, Friends & P2P splits).
- **Local CSV Restore & Upload**:
  - **Reset & Restore from `data.csv`** or paste/import any custom CSV directly in **Setup**.
- **Home Screen Widget**:
  - Interactive `Today / Week / Month` and `Combined / UPI / Cash` tabs that update instantly without opening the app.

---

## Commands

| Command | Description |
| --- | --- |
| `npm install` | Install JS dependencies |
| `npm run android` | Build & run debug build on connected Android device/emulator |
| `npm start` | Start Metro bundler |
| `npm run apk` | Build standalone release APK (`android/app/build/outputs/apk/release/app-release.apk`) |
| `npm run typecheck` | Run TypeScript typecheck (`tsc --noEmit`) |
| `npm run lint` | Run ESLint |
| `npx jest` | Run unit tests (`__tests__/v2_engine.test.ts`) |

---

## Project Layout

```text
specs/NativeExpenseCapture.ts   TurboModule spec (JS <-> Kotlin)
src/core/                       Parser, categoriser, client rules, seed CSV, money & date helpers
src/db/                         SQLite schema & migrations, deduplication, analytics queries
src/sync/                       Native queue drain -> SQLite -> Android widget sync
src/state/                      React Context store
src/ui/                         Monochromatic theme, gradient primitives, charts, TransactionRow
src/screens/                    Home, History, Insights, Setup, EditTransactionSheet
android/.../capture/            NotificationListenerService, SmsCaptureReceiver, QuickScan, queue
android/.../widget/             Home screen widget (WidgetRenderer, WidgetTheme, WidgetPrefs)
__tests__/                      Unit tests for parser, categorizer, client rules, and CSV engine
```

See [GUIDE.md](./GUIDE.md) for detailed Android SDK setup, permissions, and troubleshooting.
