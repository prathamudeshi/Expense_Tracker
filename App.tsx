/**
 * V2 App shell: status bar, safe area, minimalistic header and a floating
 * pill bottom navigation bar.
 */
import React, {useState} from 'react';
import {ActivityIndicator, Pressable, StatusBar, StyleSheet, Text, View} from 'react-native';
import {SafeAreaProvider, useSafeAreaInsets} from 'react-native-safe-area-context';

import {isCurrentMonth, monthLabelShort, shiftMonthKey} from './src/core/dates';
import {AppProvider, useApp} from './src/state/store';
import {HomeScreen} from './src/screens/HomeScreen';
import {InsightsScreen} from './src/screens/InsightsScreen';
import {SettingsScreen} from './src/screens/SettingsScreen';
import {TransactionsScreen} from './src/screens/TransactionsScreen';
import {radius, spacing, withAlpha, type Palette} from './src/ui/theme';
import {ThemeProvider, useTheme} from './src/ui/themeContext';

type TabId = 'home' | 'transactions' | 'insights' | 'settings';

const TABS: Array<{id: TabId; label: string; glyph: string}> = [
  {id: 'home', label: 'Home', glyph: '◉'},
  {id: 'transactions', label: 'History', glyph: '≡'},
  {id: 'insights', label: 'Insights', glyph: '◫'},
  {id: 'settings', label: 'Setup', glyph: '⚙'},
];

function Shell() {
  const {colors, mode} = useTheme();
  const styles = useStyles(colors);
  const {ready, capture, monthKey, setMonthKey, setHistoryCategory} = useApp();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<TabId>('home');

  const openHistory = (category?: string) => {
    setHistoryCategory(category ?? null);
    setTab('transactions');
  };

  if (!ready) {
    return (
      <View style={styles.loading}>
        <StatusBar barStyle={mode === 'light' ? 'dark-content' : 'light-content'} />
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.loadingText}>Preparing your ledger…</Text>
      </View>
    );
  }

  const showMonthPill = tab === 'home' || tab === 'transactions';

  return (
    <View style={styles.root}>
      <StatusBar barStyle={mode === 'light' ? 'dark-content' : 'light-content'} />
      <View style={[styles.header, {paddingTop: insets.top + spacing.sm}]}>
        <View style={styles.headerLeft}>
          <Text style={styles.title}>{TABS.find(item => item.id === tab)?.label}</Text>
          {capture.notificationAccess ? (
            <View style={styles.statusDotWrap}>
              <View style={styles.statusDot} />
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={() => setTab('settings')}
              style={styles.setupChip}>
              <Text style={styles.setupChipText}>Setup</Text>
            </Pressable>
          )}
        </View>

        {showMonthPill ? (
          <View style={styles.monthPill}>
            <Pressable
              accessibilityLabel="Previous month"
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => setMonthKey(shiftMonthKey(monthKey, -1))}
              style={styles.monthArrowBtn}>
              <Text style={styles.monthArrow}>‹</Text>
            </Pressable>
            <Text style={styles.monthText}>{monthLabelShort(monthKey)}</Text>
            <Pressable
              accessibilityLabel="Next month"
              accessibilityRole="button"
              disabled={isCurrentMonth(monthKey)}
              hitSlop={8}
              onPress={() => setMonthKey(shiftMonthKey(monthKey, 1))}
              style={styles.monthArrowBtn}>
              <Text
                style={[
                  styles.monthArrow,
                  isCurrentMonth(monthKey) ? styles.monthArrowDisabled : null,
                ]}>
                ›
              </Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      <View style={styles.body}>
        {tab === 'home' ? (
          <HomeScreen
            onOpenHistory={openHistory}
            onOpenSettings={() => setTab('settings')}
          />
        ) : null}
        {tab === 'transactions' ? <TransactionsScreen /> : null}
        {tab === 'insights' ? (
          <InsightsScreen onOpenHistory={openHistory} />
        ) : null}
        {tab === 'settings' ? <SettingsScreen /> : null}
      </View>

      <View style={[styles.tabBarOuter, {paddingBottom: Math.max(insets.bottom, spacing.sm)}]}>
        <View style={styles.tabBar}>
          {TABS.map(item => {
            const active = item.id === tab;
            return (
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{selected: active}}
                key={item.id}
                onPress={() => {
                  if (item.id === 'transactions' && tab !== 'transactions') {
                    setHistoryCategory(null);
                  }
                  setTab(item.id);
                }}
                style={[styles.tab, active ? styles.tabPillActive : null]}>
                <Text style={[styles.tabGlyph, active ? styles.tabTextActive : null]}>
                  {item.glyph}
                </Text>
                <Text style={[styles.tabLabel, active ? styles.tabTextActive : null]}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AppProvider>
          <Shell />
        </AppProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function useStyles(colors: Palette) {
  return React.useMemo(
    () =>
      StyleSheet.create({
        root: {
          backgroundColor: colors.bg,
          flex: 1,
        },
        loading: {
          alignItems: 'center',
          backgroundColor: colors.bg,
          flex: 1,
          justifyContent: 'center',
        },
        loadingText: {
          color: colors.textDim,
          marginTop: spacing.md,
        },
        header: {
          alignItems: 'center',
          flexDirection: 'row',
          justifyContent: 'space-between',
          paddingBottom: spacing.xs,
          paddingHorizontal: spacing.lg,
        },
        headerLeft: {
          alignItems: 'center',
          flexDirection: 'row',
          gap: spacing.sm,
        },
        title: {
          color: colors.text,
          fontSize: 24,
          fontWeight: '800',
          letterSpacing: -0.5,
        },
        statusDotWrap: {
          alignItems: 'center',
          backgroundColor: withAlpha(colors.success, 0.14),
          borderRadius: radius.pill,
          height: 18,
          justifyContent: 'center',
          width: 18,
        },
        statusDot: {
          backgroundColor: colors.success,
          borderRadius: radius.pill,
          height: 7,
          width: 7,
        },
        setupChip: {
          backgroundColor: withAlpha(colors.warning, 0.16),
          borderRadius: radius.pill,
          paddingHorizontal: 8,
          paddingVertical: 3,
        },
        setupChipText: {
          color: colors.warning,
          fontSize: 10,
          fontWeight: '700',
        },
        monthPill: {
          alignItems: 'center',
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: radius.pill,
          borderWidth: 1,
          flexDirection: 'row',
          paddingHorizontal: 6,
          paddingVertical: 4,
        },
        monthArrowBtn: {
          alignItems: 'center',
          height: 24,
          justifyContent: 'center',
          width: 24,
        },
        monthArrow: {
          color: colors.text,
          fontSize: 17,
          fontWeight: '600',
          lineHeight: 20,
        },
        monthArrowDisabled: {
          color: colors.textFaint,
          opacity: 0.45,
        },
        monthText: {
          color: colors.text,
          fontSize: 12,
          fontWeight: '700',
          paddingHorizontal: 6,
        },
        body: {
          flex: 1,
        },
        tabBarOuter: {
          backgroundColor: colors.bg,
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.xs,
        },
        tabBar: {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: radius.xl,
          borderWidth: 1,
          flexDirection: 'row',
          padding: 4,
        },
        tab: {
          alignItems: 'center',
          borderRadius: radius.lg,
          flex: 1,
          paddingVertical: 7,
        },
        tabPillActive: {
          backgroundColor: withAlpha(colors.accentDeep, colors.mode === 'dark' ? 0.22 : 0.12),
        },
        tabGlyph: {
          color: colors.textFaint,
          fontSize: 16,
        },
        tabLabel: {
          color: colors.textFaint,
          fontSize: 10,
          fontWeight: '600',
          marginTop: 2,
        },
        tabTextActive: {
          color: colors.accent,
          fontWeight: '700',
        },
      }),
    [colors],
  );
}
