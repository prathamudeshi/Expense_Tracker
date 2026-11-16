/**
 * Wrapper around the native capture TurboModule.
 *
 * The module is always present in a correctly built app. The null checks exist
 * only as a safety net for the case where the native module failed to register
 * (a broken build, or Metro connected to a stale APK) - a missing module should
 * degrade the app to manual entry, not crash it on launch.
 */
import {PermissionsAndroid} from 'react-native';
import NativeExpenseCapture from '../../specs/NativeExpenseCapture';
import type {RawCapture} from '../core/types';

const native = NativeExpenseCapture;

/** False only if the native module did not register - see note above. */
export const captureSupported: boolean = native != null;

export interface KnownApp {
  package: string;
  label: string;
  installed: boolean;
  tracked: boolean;
}

export interface DiscoveredApp {
  package: string;
  label: string;
  hits: number;
  lastSeen: number;
  sample: string;
}

export interface CaptureToggles {
  notifications: boolean;
  sms: boolean;
}

export interface Diagnostics {
  notificationAccess: boolean;
  notificationsEnabled: boolean;
  smsEnabled: boolean;
  trackedPackages: number;
  queuePending: number;
  queueTotal: number;
  widgetPinned: boolean;
  batteryUnrestricted: boolean;
  androidSdk: number;
  device: string;
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// ---- notification access ---------------------------------------------------

export function hasNotificationAccess(): boolean {
  if (!native) {
    return false;
  }
  try {
    return native.isNotificationAccessGranted();
  } catch {
    return false;
  }
}

export function openNotificationAccessSettings(): void {
  native?.openNotificationAccessSettings();
}

// ---- SMS permission (plain RN API, no native code needed) ------------------

export async function hasSmsPermission(): Promise<boolean> {
  try {
    return await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECEIVE_SMS);
  } catch {
    return false;
  }
}

export async function requestSmsPermission(): Promise<boolean> {
  try {
    const result = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.RECEIVE_SMS,
      PermissionsAndroid.PERMISSIONS.READ_SMS,
    ]);
    return result[PermissionsAndroid.PERMISSIONS.RECEIVE_SMS] === 'granted';
  } catch {
    return false;
  }
}

// ---- tracked apps ----------------------------------------------------------

export function knownPaymentApps(): KnownApp[] {
  if (!native) {
    return [];
  }
  return parseJson<KnownApp[]>(native.getKnownPaymentAppsJson(), []);
}

export function trackedPackages(): string[] {
  if (!native) {
    return [];
  }
  return parseJson<string[]>(native.getTrackedPackagesJson(), []);
}

export function setTrackedPackages(packages: string[]): void {
  native?.setTrackedPackagesJson(JSON.stringify(packages));
}

export async function discoveredApps(): Promise<DiscoveredApp[]> {
  if (!native) {
    return [];
  }
  return parseJson<DiscoveredApp[]>(await native.getDiscoveredAppsJson(), []);
}

export function clearDiscoveredApps(): void {
  native?.clearDiscoveredApps();
}

// ---- toggles ---------------------------------------------------------------

export function captureToggles(): CaptureToggles {
  if (!native) {
    return {notifications: false, sms: false};
  }
  return parseJson<CaptureToggles>(native.getCaptureEnabledJson(), {
    notifications: false,
    sms: false,
  });
}

export function setCaptureEnabled(notifications: boolean, sms: boolean): void {
  native?.setCaptureEnabled(notifications, sms);
}

// ---- queue -----------------------------------------------------------------

export async function pendingCaptures(limit = 400): Promise<RawCapture[]> {
  if (!native) {
    return [];
  }
  return parseJson<RawCapture[]>(await native.getPendingCapturesJson(limit), []);
}

export async function markCapturesConsumed(ids: number[]): Promise<number> {
  if (!native || ids.length === 0) {
    return 0;
  }
  return native.markCapturesConsumedJson(JSON.stringify(ids));
}

export async function pendingCount(): Promise<number> {
  if (!native) {
    return 0;
  }
  try {
    return await native.getPendingCount();
  } catch {
    return 0;
  }
}

// ---- SMS backfill ----------------------------------------------------------

export interface InboxMessage {
  origin: string;
  body: string;
  postedAt: number;
}

export async function readSmsInbox(sinceMillis: number, limit = 5000): Promise<InboxMessage[]> {
  if (!native) {
    return [];
  }
  return parseJson<InboxMessage[]>(await native.readSmsInboxJson(sinceMillis, limit), []);
}

// ---- widget ----------------------------------------------------------------

export interface WidgetSummary {
  monthKey: string;
  weekKey: string;
  dayKey: string;
  budget: number;
  txnCount: number;
  /** Keys are "today:all" | "today:upi" | "today:cash" | "week:..." | "month:...". */
  totals: Record<string, number>;
}

export function pushWidgetSummary(summary: WidgetSummary): void {
  native?.setWidgetSummaryJson(JSON.stringify(summary));
}

export function refreshWidget(): void {
  native?.refreshWidget();
}

export function pushThemeMode(mode: 'light' | 'dark'): void {
  native?.setThemeMode(mode);
}

export function isWidgetPinned(): boolean {
  if (!native) {
    return false;
  }
  try {
    return native.isWidgetPinned();
  } catch {
    return false;
  }
}

export async function requestPinWidget(): Promise<boolean> {
  if (!native) {
    return false;
  }
  try {
    return await native.requestPinWidget();
  } catch {
    return false;
  }
}

// ---- battery / diagnostics -------------------------------------------------

export function isBatteryUnrestricted(): boolean {
  if (!native) {
    return true;
  }
  try {
    return native.isIgnoringBatteryOptimizations();
  } catch {
    return true;
  }
}

export function openBatterySettings(): void {
  native?.openBatteryOptimizationSettings();
}

export async function diagnostics(): Promise<Diagnostics | null> {
  if (!native) {
    return null;
  }
  try {
    return parseJson<Diagnostics | null>(await native.getDiagnosticsJson(), null);
  } catch {
    return null;
  }
}
