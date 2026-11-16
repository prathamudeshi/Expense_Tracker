/**
 * Single app-wide store. Plain context + hooks rather than a state library:
 * the data all lives in SQLite, so this only has to cache the current view and
 * tell screens when to re-query.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {AppState, type AppStateStatus} from 'react-native';

import {initDatabase} from '../db/database';
import {
  categoryTotals,
  deleteTransaction,
  getNumberSetting,
  ignoredCount,
  importCsvTransactions,
  insertManualTransaction,
  listBankAccounts,
  listTransactions,
  periodSummary,
  resetAndRestoreSeedCsv,
  runSmartLedgerCleanup,
  seedDatabaseIfEmpty,
  setSetting,
  transactionCount,
  updateTransaction,
  type ManualTransactionInput,
  type TransactionPatch,
} from '../db/repository';
import {SEED_CSV} from '../core/seedData';
import type {
  AccountFilter,
  BankAccountSummary,
  CategoryTotal,
  ModeFilter,
  PeriodSummary,
  Transaction,
} from '../core/types';
import {
  captureSupported,
  captureToggles,
  hasNotificationAccess,
  hasSmsPermission,
  isBatteryUnrestricted,
  isWidgetPinned,
  pendingCount,
  setCaptureEnabled,
  type CaptureToggles,
} from '../native/capture';
import {drainCaptures, importSmsHistory, pushWidgetTotals} from '../sync/captureSync';
import {monthKey as currentMonthKey, monthRange} from '../core/dates';
import {SETTING_BUDGET, SETTING_LAST_IMPORT} from './settings';

/** How often to look for new captures while the app is in the foreground. */
const POLL_MS = 4000;

export interface CaptureState {
  supported: boolean;
  notificationAccess: boolean;
  smsPermission: boolean;
  toggles: CaptureToggles;
  batteryUnrestricted: boolean;
  widgetPinned: boolean;
  pending: number;
}

interface AppContextValue {
  ready: boolean;
  /** Increments after every mutation; screens use it as a re-query trigger. */
  version: number;
  monthKey: string;
  setMonthKey: (key: string) => void;
  /** Combined / UPI-only / Cash-only view, applied across Home, History and Insights. */
  modeFilter: ModeFilter;
  setModeFilter: (mode: ModeFilter) => void;
  /** 'ALL', 'UNLINKED', or a specific bank account tail like '911'. */
  accountFilter: AccountFilter;
  setAccountFilter: (account: AccountFilter) => void;
  accounts: BankAccountSummary[];
  historyCategory: string | null;
  setHistoryCategory: (category: string | null) => void;
  summary: PeriodSummary;
  categories: CategoryTotal[];
  recent: Transaction[];
  budget: number;
  totalCount: number;
  unrecognised: number;
  capture: CaptureState;

  reload: () => Promise<void>;
  refreshCaptureState: () => Promise<void>;
  addManual: (input: ManualTransactionInput) => Promise<void>;
  patchTransaction: (id: number, patch: TransactionPatch) => Promise<void>;
  removeTransaction: (id: number) => Promise<void>;
  saveBudget: (value: number) => Promise<void>;
  setToggles: (next: CaptureToggles) => Promise<void>;
  runSmsImport: (days: number) => Promise<{scanned: number; inserted: number; merged: number}>;
  runCleanup: () => Promise<number>;
  reseedFromCsv: () => Promise<{imported: number; skipped: number}>;
  resetAndRestoreCsv: () => Promise<number>;
  importCustomCsv: (
    csvText: string,
    clearFirst: boolean,
  ) => Promise<{imported: number; skipped: number}>;
  syncNow: () => Promise<void>;
}

const EMPTY_SUMMARY: PeriodSummary = {
  spend: 0,
  invested: 0,
  investmentCount: 0,
  income: 0,
  count: 0,
  largest: 0,
  firstAt: null,
  lastAt: null,
  upiSpend: 0,
  cashSpend: 0,
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({children}: {children: React.ReactNode}) {
  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState(0);
  const [monthKey, setMonthKey] = useState(currentMonthKey());
  const [modeFilter, setModeFilter] = useState<ModeFilter>('ALL');
  const [accountFilter, setAccountFilter] = useState<AccountFilter>('ALL');
  const [accounts, setAccounts] = useState<BankAccountSummary[]>([]);
  const [historyCategory, setHistoryCategory] = useState<string | null>(null);
  const [summary, setSummary] = useState<PeriodSummary>(EMPTY_SUMMARY);
  const [categories, setCategories] = useState<CategoryTotal[]>([]);
  const [recent, setRecent] = useState<Transaction[]>([]);
  const [budget, setBudget] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [unrecognised, setUnrecognised] = useState(0);
  const [capture, setCapture] = useState<CaptureState>({
    supported: captureSupported,
    notificationAccess: false,
    smsPermission: false,
    toggles: {notifications: false, sms: false},
    batteryUnrestricted: true,
    widgetPinned: false,
    pending: 0,
  });

  const bump = useCallback(() => setVersion(value => value + 1), []);

  const loadDashboard = useCallback(
    async (key: string, mode: ModeFilter, account: AccountFilter) => {
      const range = monthRange(key);
      const [
        nextSummary,
        nextCategories,
        nextRecent,
        nextAccounts,
        nextBudget,
        count,
        ignored,
      ] = await Promise.all([
        periodSummary(range, mode, account),
        categoryTotals(range, mode, false, account),
        listTransactions({range, mode, account, limit: 12}),
        listBankAccounts(undefined, mode),
        getNumberSetting(SETTING_BUDGET, 0),
        transactionCount(),
        ignoredCount(),
      ]);

      setSummary(nextSummary);
      setCategories(nextCategories);
      setRecent(nextRecent);
      setAccounts(nextAccounts);
      setBudget(nextBudget);
      setTotalCount(count);
      setUnrecognised(ignored);
    },
    [],
  );

  const refreshCaptureState = useCallback(async () => {
    if (!captureSupported) {
      setCapture(previous => ({...previous, supported: false}));
      return;
    }
    const [sms, pending] = await Promise.all([hasSmsPermission(), pendingCount()]);
    setCapture({
      supported: true,
      notificationAccess: hasNotificationAccess(),
      smsPermission: sms,
      toggles: captureToggles(),
      batteryUnrestricted: isBatteryUnrestricted(),
      widgetPinned: isWidgetPinned(),
      pending,
    });
  }, []);

  const reload = useCallback(async () => {
    await loadDashboard(monthKey, modeFilter, accountFilter);
    await refreshCaptureState();
    bump();
  }, [accountFilter, bump, loadDashboard, modeFilter, monthKey, refreshCaptureState]);

  /** Pull anything new out of the native queue, then refresh totals. */
  const syncNow = useCallback(async () => {
    const result = await drainCaptures();
    await pushWidgetTotals();
    if (result.processed > 0) {
      await loadDashboard(monthKey, modeFilter, accountFilter);
      bump();
    }
    await refreshCaptureState();
  }, [accountFilter, bump, loadDashboard, modeFilter, monthKey, refreshCaptureState]);

  // ---- startup ------------------------------------------------------------
  const started = useRef(false);
  useEffect(() => {
    if (started.current) {
      return;
    }
    started.current = true;

    (async () => {
      try {
        await initDatabase();
        await seedDatabaseIfEmpty();
        await runSmartLedgerCleanup(false);
        await drainCaptures();
        await loadDashboard(currentMonthKey(), 'ALL', 'ALL');
        await pushWidgetTotals();
        await refreshCaptureState();
      } catch (error) {
        console.warn('[ExpenseTracker] startup failed', error);
      } finally {
        setReady(true);
      }
    })();
  }, [loadDashboard, refreshCaptureState]);

  // ---- reload when the selected month, mode or account filter changes -----
  useEffect(() => {
    if (!ready) {
      return;
    }
    loadDashboard(monthKey, modeFilter, accountFilter).catch(error =>
      console.warn('[ExpenseTracker] month load failed', error),
    );
  }, [accountFilter, loadDashboard, modeFilter, monthKey, ready]);

  // ---- foreground polling + resume ---------------------------------------
  useEffect(() => {
    if (!ready || !captureSupported) {
      return;
    }

    const timer = setInterval(() => {
      syncNow().catch(() => {});
    }, POLL_MS);

    const subscription = AppState.addEventListener('change', (status: AppStateStatus) => {
      if (status === 'active') {
        syncNow().catch(() => {});
      }
    });

    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [ready, syncNow]);

  // ---- mutations ----------------------------------------------------------

  const afterMutation = useCallback(async () => {
    await loadDashboard(monthKey, modeFilter, accountFilter);
    await pushWidgetTotals();
    bump();
  }, [accountFilter, bump, loadDashboard, modeFilter, monthKey]);

  const addManual = useCallback(
    async (input: ManualTransactionInput) => {
      await insertManualTransaction(input);
      await afterMutation();
    },
    [afterMutation],
  );

  const patchTransaction = useCallback(
    async (id: number, patch: TransactionPatch) => {
      await updateTransaction(id, patch);
      await afterMutation();
    },
    [afterMutation],
  );

  const removeTransaction = useCallback(
    async (id: number) => {
      await deleteTransaction(id);
      await afterMutation();
    },
    [afterMutation],
  );

  const saveBudget = useCallback(
    async (value: number) => {
      await setSetting(SETTING_BUDGET, String(value));
      setBudget(value);
      await pushWidgetTotals();
      bump();
    },
    [bump],
  );

  const setToggles = useCallback(
    async (next: CaptureToggles) => {
      setCaptureEnabled(next.notifications, next.sms);
      await refreshCaptureState();
    },
    [refreshCaptureState],
  );

  const runSmsImport = useCallback(
    async (days: number) => {
      const result = await importSmsHistory(days);
      await setSetting(SETTING_LAST_IMPORT, String(Date.now()));
      await afterMutation();
      return {scanned: result.scanned, inserted: result.inserted, merged: result.merged};
    },
    [afterMutation],
  );

  const runCleanup = useCallback(async () => {
    const count = await runSmartLedgerCleanup(true);
    await afterMutation();
    return count;
  }, [afterMutation]);

  const reseedFromCsv = useCallback(async () => {
    const result = await importCsvTransactions(SEED_CSV, false);
    await runSmartLedgerCleanup(true);
    await afterMutation();
    return result;
  }, [afterMutation]);

  const resetAndRestoreCsv = useCallback(async () => {
    const imported = await resetAndRestoreSeedCsv();
    await runSmartLedgerCleanup(true);
    await afterMutation();
    return imported;
  }, [afterMutation]);

  const importCustomCsv = useCallback(
    async (csvText: string, clearFirst: boolean) => {
      const result = await importCsvTransactions(csvText, clearFirst);
      await runSmartLedgerCleanup(true);
      await afterMutation();
      return result;
    },
    [afterMutation],
  );

  const value = useMemo<AppContextValue>(
    () => ({
      ready,
      version,
      monthKey,
      setMonthKey,
      modeFilter,
      setModeFilter,
      accountFilter,
      setAccountFilter,
      accounts,
      historyCategory,
      setHistoryCategory,
      summary,
      categories,
      recent,
      budget,
      totalCount,
      unrecognised,
      capture,
      reload,
      refreshCaptureState,
      addManual,
      patchTransaction,
      removeTransaction,
      saveBudget,
      setToggles,
      runSmsImport,
      runCleanup,
      reseedFromCsv,
      resetAndRestoreCsv,
      importCustomCsv,
      syncNow,
    }),
    [
      accountFilter,
      accounts,
      addManual,
      budget,
      capture,
      categories,
      historyCategory,
      importCustomCsv,
      modeFilter,
      monthKey,
      patchTransaction,
      ready,
      recent,
      refreshCaptureState,
      reload,
      removeTransaction,
      reseedFromCsv,
      resetAndRestoreCsv,
      runCleanup,
      runSmsImport,
      saveBudget,
      setToggles,
      summary,
      syncNow,
      totalCount,
      unrecognised,
      version,
    ],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used inside <AppProvider>');
  }
  return context;
}
