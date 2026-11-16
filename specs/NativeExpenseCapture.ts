/**
 * Turbo Native Module spec for the Android payment-capture layer.
 *
 * Everything crosses the bridge as JSON strings / primitives on purpose: it keeps
 * the Codegen surface tiny and lets the TypeScript parser own all of the
 * interesting logic.
 */
import type {TurboModule} from 'react-native';
import {TurboModuleRegistry} from 'react-native';

export interface Spec extends TurboModule {
  /** Sanity check that the native module registered correctly. */
  isSupported(): boolean;

  // ---- Notification access (the primary capture channel) -------------------
  isNotificationAccessGranted(): boolean;
  openNotificationAccessSettings(): void;

  // ---- Which apps we listen to -------------------------------------------
  /** JSON: [{ "package": string, "label": string, "installed": boolean }] */
  getKnownPaymentAppsJson(): string;
  /** JSON: string[] of package names. */
  getTrackedPackagesJson(): string;
  setTrackedPackagesJson(json: string): void;
  /**
   * Apps that posted a notification which *looked* like a payment alert but are
   * not being tracked yet. Lets the user discover the right package name for a
   * bank/UPI app we don't ship in the known list.
   * JSON: [{ package, hits, lastSeen, sample }]
   */
  getDiscoveredAppsJson(): Promise<string>;
  clearDiscoveredApps(): void;

  // ---- Channel toggles ----------------------------------------------------
  setCaptureEnabled(notifications: boolean, sms: boolean): void;
  /** JSON: { "notifications": boolean, "sms": boolean } */
  getCaptureEnabledJson(): string;

  // ---- The capture queue (written natively, drained by JS) ----------------
  /** JSON: [{ id, source, origin, title, body, postedAt }] oldest first. */
  getPendingCapturesJson(limit: number): Promise<string>;
  /** idsJson is a JSON array of numeric ids. Resolves with the rows updated. */
  markCapturesConsumedJson(idsJson: string): Promise<number>;
  getPendingCount(): Promise<number>;

  // ---- One-off backfill from the SMS inbox --------------------------------
  /** JSON: [{ origin, body, postedAt }] */
  readSmsInboxJson(sinceMillis: number, limit: number): Promise<string>;

  // ---- Home screen widget -------------------------------------------------
  /**
   * JSON: { monthKey, monthTotal, dayKey, dayTotal, budget, txnCount, currency }
   * These are authoritative totals from the database; the widget adds any
   * not-yet-consumed captures on top so it stays fresh while the app is closed.
   */
  setWidgetSummaryJson(json: string): void;
  refreshWidget(): void;
  isWidgetPinned(): boolean;
  requestPinWidget(): Promise<boolean>;
  /** "light" or "dark". Mirrors the in-app theme so the widget matches it. */
  setThemeMode(mode: string): void;

  // ---- Misc ---------------------------------------------------------------
  openBatteryOptimizationSettings(): void;
  isIgnoringBatteryOptimizations(): boolean;
  /** JSON blob used by the Settings > Diagnostics panel. */
  getDiagnosticsJson(): Promise<string>;
}

// `get` rather than `getEnforcing`: if the native module ever fails to register
// we want the app to fall back to manual entry instead of crashing on launch.
export default TurboModuleRegistry.get<Spec>('NativeExpenseCapture');
