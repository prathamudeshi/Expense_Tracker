/**
 * Setup, Forever Client Classification Rules, Bank Account management,
 * local CSV upload/restore, and diagnostics.
 */
import React, {useCallback, useEffect, useState} from 'react';
import {
  Alert,
  Linking,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {CATEGORIES, categoryMeta, DEFAULT_CLIENT_RULES, type CategoryRule} from '../core/categorize';
import {dayHeading} from '../core/dates';
import {money} from '../core/money';
import type {IgnoredMessage} from '../core/types';
import {databasePath} from '../db/database';
import {
  clearIgnoredMessages,
  deleteCategoryRule,
  exportCsv,
  exportJson,
  listCategoryRules,
  listIgnoredMessages,
  resetAllData,
  setAccountLabel,
  upsertCategoryRule,
} from '../db/repository';
import {
  clearDiscoveredApps,
  diagnostics as loadDiagnostics,
  discoveredApps,
  isWidgetPinned,
  knownPaymentApps,
  openBatterySettings,
  openNotificationAccessSettings,
  requestPinWidget,
  requestSmsPermission,
  setTrackedPackages,
  trackedPackages,
  type Diagnostics,
  type DiscoveredApp,
  type KnownApp,
} from '../native/capture';
import {useApp} from '../state/store';
import {
  Banner,
  Card,
  Chip,
  Divider,
  Field,
  GhostButton,
  Label,
  Muted,
  PrimaryButton,
  SectionHeader,
  SegmentedControl,
  Sheet,
  TappableRow,
  ToggleRow,
} from '../ui/components';
import {radius, spacing, type Palette} from '../ui/theme';
import {useTheme} from '../ui/themeContext';

export function SettingsScreen() {
  const {colors, mode, setMode} = useTheme();
  const styles = useStyles(colors);
  const {
    budget,
    saveBudget,
    capture,
    refreshCaptureState,
    setToggles,
    runSmsImport,
    runCleanup,
    resetAndRestoreCsv,
    importCustomCsv,
    accounts,
    reload,
    totalCount,
    unrecognised,
  } = useApp();

  const [budgetDraft, setBudgetDraft] = useState(budget > 0 ? String(budget) : '');
  const [apps, setApps] = useState<KnownApp[]>([]);
  const [suggestions, setSuggestions] = useState<DiscoveredApp[]>([]);
  const [customPackage, setCustomPackage] = useState('');
  const [importing, setImporting] = useState(false);
  const [ignored, setIgnored] = useState<IgnoredMessage[]>([]);
  const [showIgnored, setShowIgnored] = useState(false);
  const [diag, setDiag] = useState<Diagnostics | null>(null);
  const [widgetPinned, setWidgetPinned] = useState(false);

  // Client forever rules state
  const [rules, setRules] = useState<CategoryRule[]>([]);
  const [ruleSheetOpen, setRuleSheetOpen] = useState(false);
  const [ruleKeyword, setRuleKeyword] = useState('');
  const [ruleDisplayName, setRuleDisplayName] = useState('');
  const [ruleCategory, setRuleCategory] = useState<string>('Food & Drink');
  const [ruleDefaultNote, setRuleDefaultNote] = useState('');
  const [ruleExclude, setRuleExclude] = useState(false);

  // Local CSV upload sheet state
  const [csvSheetOpen, setCsvSheetOpen] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [csvWipeFirst, setCsvWipeFirst] = useState(true);
  const [csvUploading, setCsvUploading] = useState(false);

  // Bank account nickname state
  const [editingTail, setEditingTail] = useState<string | null>(null);
  const [accountNickDraft, setAccountNickDraft] = useState('');

  const refreshAppsAndRules = useCallback(async () => {
    setApps(knownPaymentApps());
    setSuggestions(await discoveredApps());
    setWidgetPinned(isWidgetPinned());
    setRules(await listCategoryRules());
  }, []);

  useEffect(() => {
    setBudgetDraft(budget > 0 ? String(budget) : '');
  }, [budget]);

  useEffect(() => {
    refreshAppsAndRules().catch(() => {});
    loadDiagnostics()
      .then(setDiag)
      .catch(() => {});
  }, [refreshAppsAndRules, capture.notificationAccess]);

  // ---- client forever rules -----------------------------------------------

  const saveClientRule = async () => {
    const kw = ruleKeyword.trim();
    if (!kw) {
      Alert.alert('Enter a client keyword', 'e.g. Pills N More, Hubble, Zerodha');
      return;
    }
    const updatedCount = await upsertCategoryRule(kw, ruleCategory, {
      counterpartyOverride: ruleDisplayName.trim() || kw,
      defaultNote: ruleDefaultNote.trim() || null,
      autoExclude: ruleExclude,
    });
    await refreshAppsAndRules();
    await reload();
    setRuleKeyword('');
    setRuleDisplayName('');
    setRuleDefaultNote('');
    setRuleExclude(false);
    setRuleSheetOpen(false);
    Alert.alert(
      'Client rule saved forever',
      `All future payments matching "${kw}" will be classified as ${ruleCategory}. Updated ${updatedCount} existing transaction${updatedCount === 1 ? '' : 's'}.`,
    );
  };

  const removeRule = async (keyword: string) => {
    await deleteCategoryRule(keyword);
    await refreshAppsAndRules();
  };

  // ---- bank account nicknames ---------------------------------------------

  const saveAccountNickname = async () => {
    if (!editingTail) {
      return;
    }
    await setAccountLabel(editingTail, accountNickDraft);
    setEditingTail(null);
    setAccountNickDraft('');
    await reload();
  };

  // ---- tracked apps -------------------------------------------------------

  const toggleApp = async (pkg: string, tracked: boolean) => {
    const current = new Set(trackedPackages());
    if (tracked) {
      current.add(pkg);
    } else {
      current.delete(pkg);
    }
    setTrackedPackages(Array.from(current));
    await refreshAppsAndRules();
  };

  const addCustomPackage = async () => {
    const pkg = customPackage.trim();
    if (!pkg || !pkg.includes('.')) {
      Alert.alert('Not a package name', 'Expected something like com.phonepe.app');
      return;
    }
    await toggleApp(pkg, true);
    setCustomPackage('');
  };

  // ---- actions ------------------------------------------------------------

  const grantNotificationAccess = () => {
    openNotificationAccessSettings();
    setTimeout(() => {
      refreshCaptureState().catch(() => {});
    }, 1500);
  };

  const grantSms = async () => {
    const granted = await requestSmsPermission();
    await refreshCaptureState();
    if (!granted) {
      Alert.alert(
        'SMS permission denied',
        'Notification capture still works on its own. SMS only adds the UPI reference number and account digits.',
      );
    }
  };

  const doImport = (days: number) => {
    Alert.alert(
      'Import past SMS?',
      `Scans the last ${days} days of your SMS inbox for bank payment alerts.`,
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Import',
          onPress: async () => {
            setImporting(true);
            try {
              const result = await runSmsImport(days);
              Alert.alert(
                'Import finished',
                `Scanned ${result.scanned} messages.\nAdded ${result.inserted} transactions.\nMerged ${result.merged} into existing ones.`,
              );
            } catch (error) {
              Alert.alert('Import failed', String(error));
            } finally {
              setImporting(false);
            }
          },
        },
      ],
    );
  };

  const confirmResetAndRestoreCsv = () => {
    Alert.alert(
      'Reset & restore data.csv?',
      'This deletes all current transactions (clearing any messed-up SMS sync) and cleanly loads your 177 rows from data.csv.',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Reset & Restore',
          style: 'destructive',
          onPress: async () => {
            try {
              const count = await resetAndRestoreCsv();
              Alert.alert('Restored', `Wiped old rows and loaded ${count} clean transactions from data.csv.`);
            } catch (error) {
              Alert.alert('Restore failed', String(error));
            }
          },
        },
      ],
    );
  };

  const handleCustomCsvImport = async () => {
    if (!csvText.trim()) {
      Alert.alert('Paste CSV data', 'Paste your CSV rows (with date,time,amount... header) first.');
      return;
    }
    setCsvUploading(true);
    try {
      const res = await importCustomCsv(csvText, csvWipeFirst);
      setCsvSheetOpen(false);
      setCsvText('');
      Alert.alert(
        'CSV imported',
        `Imported ${res.imported} transaction${res.imported === 1 ? '' : 's'}${res.skipped > 0 ? ` (${res.skipped} duplicates skipped)` : ''}.`,
      );
    } catch (error) {
      Alert.alert('Import failed', String(error));
    } finally {
      setCsvUploading(false);
    }
  };

  const addWidget = async () => {
    const accepted = await requestPinWidget();
    setWidgetPinned(isWidgetPinned());
    if (!accepted) {
      Alert.alert(
        'Add it from the home screen',
        'Long-press an empty area of the home screen, tap Widgets, find Expense Tracker and drag "Monthly spend" out.',
      );
    }
  };

  const shareExport = async (kind: 'csv' | 'json') => {
    try {
      const payload = kind === 'csv' ? await exportCsv() : await exportJson();
      if (!payload.trim()) {
        Alert.alert('Nothing to export', 'There are no transactions yet.');
        return;
      }
      await Share.share({
        message: payload,
        title: `Expense Tracker export (${kind.toUpperCase()})`,
      });
    } catch (error) {
      Alert.alert('Export failed', String(error));
    }
  };

  const openIgnored = async () => {
    setIgnored(await listIgnoredMessages(60));
    setShowIgnored(value => !value);
  };

  const confirmReset = () => {
    Alert.alert(
      'Delete all data?',
      'Every stored transaction, rule and setting is removed from this device.',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Delete everything',
          style: 'destructive',
          onPress: async () => {
            try {
              await resetAllData();
              await reload();
              Alert.alert('Done', 'All local data has been deleted.');
            } catch (error) {
              Alert.alert('Could not delete', String(error));
            }
          },
        },
      ],
    );
  };

  const commitBudget = async () => {
    const parsed = Number(budgetDraft.replace(/[^\d.]/g, ''));
    await saveBudget(Number.isFinite(parsed) && parsed > 0 ? parsed : 0);
  };

  const linkedAccounts = accounts.filter(a => a.accountTail !== 'UNLINKED');

  return (
    <>
      <ScrollView contentContainerStyle={styles.content}>
        {!capture.notificationAccess ? (
          <Banner
            actionLabel="Grant notification access"
            body="Required to read UPI alerts automatically in the background."
            onAction={grantNotificationAccess}
            title="Notification access required"
          />
        ) : (
          <Banner
            body="UPI notifications and widget updates are active."
            title="Auto-tracking active"
            tone="info"
          />
        )}

        {/* ---- Forever Client Classification Rules ---- */}
        <Card style={styles.card}>
          <SectionHeader
            action={
              <GhostButton
                onPress={() => setRuleSheetOpen(true)}
                title="+ Add rule"
              />
            }
            title="Client classification rules"
          />
          <Muted style={styles.hint}>
            Set how common clients (like Pills N More, Hubble) are named and classified forever. Any
            investment is automatically named Invest.
          </Muted>

          {rules.length > 0 ? (
            <View style={styles.ruleList}>
              <Label>Your custom rules</Label>
              {rules.map(rule => (
                <View key={rule.keyword} style={styles.ruleRow}>
                  <View style={styles.flex1}>
                    <Text style={styles.ruleTitle}>
                      {rule.counterpartyOverride || rule.keyword} → {rule.category}
                    </Text>
                    <Muted style={styles.ruleSub}>
                      Matches "{rule.keyword}"
                      {rule.defaultNote ? ` · Note: ${rule.defaultNote}` : ''}
                      {rule.autoExclude ? ' · Auto-excluded' : ''}
                    </Muted>
                  </View>
                  <GhostButton
                    onPress={() => removeRule(rule.keyword)}
                    title="Remove"
                  />
                </View>
              ))}
            </View>
          ) : null}

          <View style={styles.ruleList}>
            <Label>Built-in client presets</Label>
            {DEFAULT_CLIENT_RULES.slice(0, 8).map(preset => (
              <View key={preset.keyword} style={styles.presetRow}>
                <Text style={styles.presetName}>
                  {preset.counterpartyOverride || preset.keyword}
                </Text>
                <Muted style={styles.presetCat}>{preset.category}</Muted>
              </View>
            ))}
          </View>
        </Card>

        {/* ---- Bank Accounts Management ---- */}
        {linkedAccounts.length > 0 ? (
          <Card style={styles.card}>
            <SectionHeader title="Bank accounts" />
            <Muted style={styles.hint}>
              Accounts are tracked separately by their last digits. Tap an account to give it a
              custom bank label.
            </Muted>
            {linkedAccounts.map(acc => (
              <TappableRow
                key={acc.accountTail}
                onPress={() => {
                  setEditingTail(acc.accountTail);
                  setAccountNickDraft('');
                }}
                subtitle={`${acc.count} txns · Spend ${money(acc.spend)} · Invest ${money(acc.invested)}`}
                title={acc.label}
                value="Label"
              />
            ))}
            {editingTail ? (
              <View style={styles.inlineRow}>
                <TextInput
                  autoCapitalize="words"
                  onChangeText={setAccountNickDraft}
                  placeholder={`Bank name for ••${editingTail} (e.g. ICICI)`}
                  placeholderTextColor={colors.textFaint}
                  style={styles.inlineInput}
                  value={accountNickDraft}
                />
                <GhostButton onPress={saveAccountNickname} title="Save" />
              </View>
            ) : null}
          </Card>
        ) : null}

        {/* ---- Data & Local CSV Upload / Restore ---- */}
        <Card style={styles.card}>
          <SectionHeader title="Your data & CSV restore" />
          <Muted style={styles.hint}>
            {totalCount} transaction{totalCount === 1 ? '' : 's'} stored locally. If an SMS import
            messed up your ledger, reset and restore your clean CSV below.
          </Muted>

          <PrimaryButton
            gradient={colors.accentGradient}
            onPress={confirmResetAndRestoreCsv}
            style={styles.action}
            title="Reset & Restore from data.csv"
          />

          <View style={styles.buttonRow}>
            <GhostButton
              onPress={() => setCsvSheetOpen(true)}
              title="Upload / Paste Custom CSV"
            />
            <GhostButton
              onPress={async () => {
                const changed = await runCleanup();
                Alert.alert(
                  'Ledger cleaned',
                  changed > 0
                    ? `Cleaned and updated ${changed} transaction${changed === 1 ? '' : 's'}.`
                    : 'All transactions are already clean.',
                );
              }}
              title="Smart Clean"
            />
          </View>

          <View style={styles.buttonRow}>
            <GhostButton onPress={() => shareExport('csv')} title="Export CSV" />
            <GhostButton onPress={() => shareExport('json')} title="Export JSON" />
          </View>

          <Divider />
          <Label>Database file</Label>
          <Text selectable style={styles.mono}>
            {databasePath()}
          </Text>
          <Divider />
          <PrimaryButton onPress={confirmReset} title="Delete all data" tone="danger" />
        </Card>

        {/* ---- Appearance ---- */}
        <Card style={styles.card}>
          <SectionHeader title="Appearance" />
          <SegmentedControl
            onChange={setMode}
            options={[
              {value: 'dark', label: 'Dark (Recommended)'},
              {value: 'light', label: 'Light'},
            ]}
            value={mode}
          />
        </Card>

        {/* ---- Monthly budget ---- */}
        <Card style={styles.card}>
          <SectionHeader title="Monthly budget" />
          <View style={styles.inlineRow}>
            <TextInput
              keyboardType="decimal-pad"
              onChangeText={setBudgetDraft}
              onEndEditing={commitBudget}
              placeholder="0"
              placeholderTextColor={colors.textFaint}
              style={styles.inlineInput}
              value={budgetDraft}
            />
            <GhostButton onPress={commitBudget} title="Save" />
          </View>
        </Card>

        {/* ---- Capture channels ---- */}
        <Card style={styles.card}>
          <SectionHeader title="Capture channels" />
          <ToggleRow
            onValueChange={next => setToggles({...capture.toggles, notifications: next})}
            subtitle="Primary source from selected payment apps."
            title="Payment notifications"
            value={capture.toggles.notifications}
          />
          <Divider />
          <ToggleRow
            onValueChange={next => setToggles({...capture.toggles, sms: next})}
            subtitle="Adds UPI reference, account digits, and inbox backfill."
            title="Bank SMS"
            value={capture.toggles.sms}
          />
          {capture.toggles.sms && !capture.smsPermission ? (
            <GhostButton onPress={grantSms} title="Allow SMS permission" />
          ) : null}
        </Card>

        {/* ---- Tracked apps ---- */}
        <Card style={styles.card}>
          <SectionHeader title="Apps to watch" />
          {apps.map(app => (
            <ToggleRow
              key={app.package}
              onValueChange={next => toggleApp(app.package, next)}
              subtitle={app.installed ? app.package : `${app.package} · not installed`}
              title={app.label}
              value={app.tracked}
            />
          ))}

          {suggestions.length > 0 ? (
            <>
              <Divider />
              <Label>Discovered payment apps</Label>
              {suggestions.map(item => (
                <TappableRow
                  key={item.package}
                  onPress={() => toggleApp(item.package, true)}
                  subtitle={`${item.package} · ${item.hits} alert${item.hits === 1 ? '' : 's'}`}
                  title={item.label}
                  value="Add"
                />
              ))}
              <GhostButton
                onPress={async () => {
                  clearDiscoveredApps();
                  await refreshAppsAndRules();
                }}
                title="Clear suggestions"
              />
            </>
          ) : null}

          <Divider />
          <Label>Add package manually</Label>
          <View style={styles.inlineRow}>
            <TextInput
              autoCapitalize="none"
              onChangeText={setCustomPackage}
              placeholder="com.example.bank"
              placeholderTextColor={colors.textFaint}
              style={styles.inlineInput}
              value={customPackage}
            />
            <GhostButton onPress={addCustomPackage} title="Add" />
          </View>
        </Card>

        {/* ---- Home screen widget ---- */}
        <Card style={styles.card}>
          <SectionHeader title="Home screen widget" />
          <PrimaryButton
            onPress={addWidget}
            title={widgetPinned ? 'Add another widget' : 'Add widget to home screen'}
            tone={widgetPinned ? 'neutral' : 'accent'}
          />
        </Card>

        {/* ---- SMS Backfill ---- */}
        <Card style={styles.card}>
          <SectionHeader title="Import past SMS" />
          <Muted style={styles.hint}>
            Scans SMS inbox for bank alerts. Use "Reset & Restore from data.csv" above if you want
            to undo an SMS import.
          </Muted>
          <View style={styles.buttonRow}>
            <GhostButton onPress={() => doImport(30)} title="Last 30 days" />
            <GhostButton onPress={() => doImport(90)} title="90 days" />
            <GhostButton onPress={() => doImport(365)} title="1 year" />
          </View>
          {importing ? <Muted style={styles.hint}>Importing…</Muted> : null}
        </Card>

        {/* ---- Reliability ---- */}
        <Card style={styles.card}>
          <SectionHeader title="Reliability" />
          <TappableRow
            onPress={openBatterySettings}
            subtitle={
              capture.batteryUnrestricted
                ? 'Unrestricted.'
                : 'Set this app to Unrestricted so Android does not kill capture.'
            }
            title="Battery optimisation"
            value={capture.batteryUnrestricted ? 'OK' : 'Fix'}
          />
          <Divider />
          <TappableRow
            onPress={openIgnored}
            subtitle="Messages rejected by the parser."
            title="Unrecognised messages"
            value={String(unrecognised)}
          />
          {showIgnored ? (
            <View style={styles.ignoredBox}>
              {ignored.length === 0 ? (
                <Muted>No unrecognised messages.</Muted>
              ) : (
                ignored.slice(0, 25).map(item => (
                  <View key={item.id} style={styles.ignoredItem}>
                    <Text style={styles.ignoredMeta}>
                      {item.origin} · {dayHeading(item.receivedAt)} · {item.reason}
                    </Text>
                    <Text style={styles.ignoredBody}>{item.body}</Text>
                  </View>
                ))
              )}
              {ignored.length > 0 ? (
                <GhostButton
                  onPress={async () => {
                    await clearIgnoredMessages();
                    setIgnored([]);
                    await reload();
                  }}
                  title="Clear list"
                />
              ) : null}
            </View>
          ) : null}
        </Card>

        {/* ---- Diagnostics ---- */}
        {diag ? (
          <Card style={styles.card}>
            <SectionHeader title="Diagnostics" />
            <DiagRow label="Notification access" styles={styles} value={diag.notificationAccess ? 'yes' : 'no'} />
            <DiagRow label="Notifications enabled" styles={styles} value={diag.notificationsEnabled ? 'yes' : 'no'} />
            <DiagRow label="SMS enabled" styles={styles} value={diag.smsEnabled ? 'yes' : 'no'} />
            <DiagRow label="Apps watched" styles={styles} value={String(diag.trackedPackages)} />
            <DiagRow label="Queue pending" styles={styles} value={String(diag.queuePending)} />
            <DiagRow label="Widget placed" styles={styles} value={diag.widgetPinned ? 'yes' : 'no'} />
            <DiagRow label="Device" styles={styles} value={`${diag.device} (API ${diag.androidSdk})`} />
          </Card>
        ) : null}

        <GhostButton
          onPress={() => Linking.openSettings()}
          style={styles.action}
          title="Open app info in Android settings"
        />
      </ScrollView>

      {/* ---- Add Client Forever Rule Sheet ---- */}
      <Sheet
        onClose={() => setRuleSheetOpen(false)}
        title="New client rule (forever)"
        visible={ruleSheetOpen}>
        <Field
          autoCapitalize="words"
          label="When client / message contains"
          onChangeText={text => {
            setRuleKeyword(text);
            if (!ruleDisplayName) {
              setRuleDisplayName(text);
            }
          }}
          placeholder="e.g. Pills N More, Hubble, Apollo"
          value={ruleKeyword}
        />

        <Field
          autoCapitalize="words"
          label="Set client display name to"
          onChangeText={setRuleDisplayName}
          placeholder="e.g. Pills N More"
          value={ruleDisplayName}
        />

        <Field
          label="Default note (optional)"
          onChangeText={setRuleDefaultNote}
          placeholder="e.g. Chaas / Snack"
          value={ruleDefaultNote}
        />

        <Label>Classify forever into category</Label>
        <View style={styles.chipWrap}>
          {CATEGORIES.map(item => {
            const cm = categoryMeta(item);
            return (
              <Chip
                key={item}
                label={`${cm.icon}  ${cm.shortLabel}`}
                onPress={() => setRuleCategory(item)}
                selected={ruleCategory === item}
              />
            );
          })}
        </View>

        <ToggleRow
          onValueChange={setRuleExclude}
          subtitle="Automatically mark matching payments as excluded from totals."
          title="Always exclude from totals"
          value={ruleExclude}
        />

        <PrimaryButton
          gradient={colors.accentGradient}
          onPress={saveClientRule}
          style={styles.action}
          title="Save rule & apply to history"
        />
      </Sheet>

      {/* ---- Local CSV Upload / Paste Sheet ---- */}
      <Sheet
        onClose={() => setCsvSheetOpen(false)}
        title="Upload / Paste CSV locally"
        visible={csvSheetOpen}>
        <ToggleRow
          onValueChange={setCsvWipeFirst}
          subtitle="Recommended if you want a clean slate from your CSV."
          title="Wipe existing transactions first"
          value={csvWipeFirst}
        />

        <Field
          autoCapitalize="none"
          label="CSV content (date,time,amount,direction...)"
          multiline
          onChangeText={setCsvText}
          placeholder="Paste your CSV rows here..."
          value={csvText}
        />

        <PrimaryButton
          gradient={colors.accentGradient}
          loading={csvUploading}
          onPress={handleCustomCsvImport}
          title="Import CSV now"
        />
      </Sheet>
    </>
  );
}

function DiagRow({label, value, styles}: {label: string; value: string; styles: SettingsStyles}) {
  return (
    <View style={styles.diagRow}>
      <Muted>{label}</Muted>
      <Text style={styles.diagValue}>{value}</Text>
    </View>
  );
}

type SettingsStyles = ReturnType<typeof buildStyles>;

function buildStyles(colors: Palette) {
  return StyleSheet.create({
    content: {
      padding: spacing.lg,
      paddingBottom: spacing.xxl,
    },
    card: {
      marginTop: spacing.lg,
    },
    hint: {
      fontSize: 12,
      marginTop: spacing.xs,
    },
    action: {
      marginTop: spacing.md,
    },
    buttonRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      marginTop: spacing.md,
    },
    inlineRow: {
      alignItems: 'center',
      flexDirection: 'row',
      marginTop: spacing.sm,
    },
    inlineInput: {
      backgroundColor: colors.surfaceAlt,
      borderColor: colors.border,
      borderRadius: radius.md,
      borderWidth: 1,
      color: colors.text,
      flex: 1,
      marginRight: spacing.sm,
      minHeight: 44,
      paddingHorizontal: spacing.md,
    },
    flex1: {
      flex: 1,
      paddingRight: spacing.sm,
    },
    ruleList: {
      marginTop: spacing.md,
    },
    ruleRow: {
      alignItems: 'center',
      borderBottomColor: colors.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: spacing.sm,
    },
    ruleTitle: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
    },
    ruleSub: {
      fontSize: 11,
      marginTop: 2,
    },
    presetRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 5,
    },
    presetName: {
      color: colors.textDim,
      fontSize: 13,
      fontWeight: '600',
    },
    presetCat: {
      fontSize: 12,
    },
    chipWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginBottom: spacing.md,
    },
    ignoredBox: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.md,
      marginTop: spacing.sm,
      padding: spacing.md,
    },
    ignoredItem: {
      marginBottom: spacing.md,
    },
    ignoredMeta: {
      color: colors.textFaint,
      fontSize: 10,
      marginBottom: 2,
    },
    ignoredBody: {
      color: colors.textDim,
      fontSize: 12,
      lineHeight: 17,
    },
    mono: {
      color: colors.textDim,
      fontFamily: 'monospace',
      fontSize: 11,
      marginTop: spacing.xs,
    },
    diagRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: spacing.xs,
    },
    diagValue: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '600',
    },
  });
}

function useStyles(colors: Palette): SettingsStyles {
  return React.useMemo(() => buildStyles(colors), [colors]);
}
