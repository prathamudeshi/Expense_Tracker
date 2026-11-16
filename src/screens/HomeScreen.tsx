import React, {useMemo, useState} from 'react';
import {Pressable, RefreshControl, ScrollView, StyleSheet, Text, View} from 'react-native';

import {categoryMeta} from '../core/categorize';
import {daysElapsedInMonth, daysInMonth} from '../core/dates';
import {money, moneyExact} from '../core/money';
import type {Transaction} from '../core/types';
import {
  AccountPills,
  Banner,
  Card,
  EmptyState,
  GradientSurface,
  LinearGradientBar,
  Muted,
  PrimaryButton,
  SectionHeader,
  SegmentedControl,
  StackedAllocationBar,
  StatTile,
} from '../ui/components';
import {TransactionRow} from '../ui/TransactionRow';
import {categoryColor, radius, spacing, withAlpha, type Palette} from '../ui/theme';
import {useTheme} from '../ui/themeContext';
import {useApp} from '../state/store';
import {openNotificationAccessSettings} from '../native/capture';
import {EditTransactionSheet} from './EditTransactionSheet';

export function HomeScreen({
  onOpenSettings,
  onOpenHistory,
}: {
  onOpenSettings: () => void;
  onOpenHistory: (category?: string) => void;
}) {
  const {colors, mode} = useTheme();
  const styles = useStyles(colors);
  const {
    monthKey,
    modeFilter,
    setModeFilter,
    accountFilter,
    setAccountFilter,
    accounts,
    summary,
    categories,
    recent,
    budget,
    capture,
    syncNow,
    refreshCaptureState,
  } = useApp();

  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const elapsed = daysElapsedInMonth(monthKey);
  const totalDays = daysInMonth(monthKey);
  const dailyAverage = elapsed > 0 ? summary.spend / elapsed : 0;
  const projected = dailyAverage * totalDays;

  const budgetRatio = budget > 0 ? summary.spend / budget : 0;
  const budgetGradient: [string, string] =
    budgetRatio >= 1 ? colors.dangerGradient : colors.accentGradient;

  const allocationSegments = useMemo(
    () =>
      categories.map(item => {
        const meta = categoryMeta(item.category);
        return {
          key: item.category,
          label: meta.shortLabel,
          icon: meta.icon,
          value: item.total,
          color: categoryColor(item.category, mode),
        };
      }),
    [categories, mode],
  );

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await syncNow();
    } finally {
      setRefreshing(false);
    }
  };

  const openEditor = (transaction: Transaction | null) => {
    setEditing(transaction);
    setSheetOpen(true);
  };

  const needsSetup = capture.supported && !capture.notificationAccess;
  const accountLabel =
    accountFilter === 'ALL'
      ? ''
      : accountFilter === 'UNLINKED'
        ? ' · Unlinked'
        : ` · ••${accountFilter}`;

  return (
    <>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            onRefresh={onRefresh}
            refreshing={refreshing}
            tintColor={colors.accent}
          />
        }>
        {needsSetup ? (
          <Banner
            actionLabel="Grant notification access"
            body="Enable notification access so UPI payments capture automatically."
            onAction={() => {
              openNotificationAccessSettings();
              setTimeout(() => {
                refreshCaptureState().catch(() => {});
              }, 1500);
            }}
            title="Auto-tracking is off"
          />
        ) : null}

        <SegmentedControl
          onChange={setModeFilter}
          options={[
            {value: 'ALL', label: 'Combined'},
            {value: 'UPI', label: 'UPI'},
            {value: 'CASH', label: 'Cash'},
          ]}
          value={modeFilter}
        />

        {accounts.length > 0 ? (
          <View style={styles.accountRow}>
            <AccountPills
              accounts={accounts}
              onChange={setAccountFilter}
              value={accountFilter}
            />
          </View>
        ) : null}

        <GradientSurface
          colors={colors.heroGradient}
          glowColor={colors.accent}
          style={styles.heroCard}>
          <View style={styles.heroTopRow}>
            <Text style={styles.heroKicker}>
              {modeFilter === 'ALL' ? 'LIVING SPEND' : `LIVING SPEND · ${modeFilter}`}
              {accountLabel}
            </Text>
            <View style={[styles.pacePill, {backgroundColor: withAlpha(colors.accent, 0.14)}]}>
              <Text style={[styles.paceText, {color: colors.accent}]}>
                {money(dailyAverage)}/day
              </Text>
            </View>
          </View>

          <Text style={styles.heroAmount}>{money(summary.spend)}</Text>

          {modeFilter === 'ALL' && summary.cashSpend > 0 ? (
            <Muted style={styles.heroSplit}>
              UPI {money(summary.upiSpend)} · Cash {money(summary.cashSpend)}
            </Muted>
          ) : null}

          {modeFilter === 'ALL' && accountFilter === 'ALL' && budget > 0 ? (
            <View style={styles.budgetBlock}>
              <LinearGradientBar
                colors={budgetGradient}
                height={6}
                ratio={budgetRatio}
                trackColor={withAlpha(colors.text, 0.08)}
              />
              <View style={styles.budgetRow}>
                <Muted style={styles.budgetText}>
                  {Math.round(budgetRatio * 100)}% of {money(budget)}
                </Muted>
                <Muted style={styles.budgetText}>
                  {summary.spend > budget
                    ? `${money(summary.spend - budget)} over`
                    : `${money(budget - summary.spend)} left`}
                </Muted>
              </View>
            </View>
          ) : modeFilter === 'ALL' && accountFilter === 'ALL' ? (
            <Pressable onPress={onOpenSettings} style={styles.budgetPrompt}>
              <Text style={[styles.budgetPromptText, {color: colors.accent}]}>
                + Set monthly budget
              </Text>
            </Pressable>
          ) : null}

          <View style={styles.statRow}>
            <Pressable
              onPress={() => onOpenHistory('Investment')}
              style={styles.statPress}>
              <StatTile
                bg={withAlpha(colors.accent, 0.1)}
                label="Invest"
                tone={colors.invest}
                value={money(summary.invested)}
              />
            </Pressable>
            <View style={styles.statGap} />
            <StatTile
              bg={withAlpha(colors.text, 0.05)}
              label="Received"
              tone={colors.accent}
              value={money(summary.income)}
            />
            <View style={styles.statGap} />
            <StatTile
              bg={withAlpha(colors.text, 0.05)}
              label="Projected"
              value={money(projected)}
            />
          </View>
        </GradientSurface>

        <Card style={styles.card}>
          <SectionHeader
            action={
              <Pressable onPress={() => onOpenHistory()}>
                <Text style={styles.linkText}>See all</Text>
              </Pressable>
            }
            title="Where it went"
          />
          <StackedAllocationBar
            formatValue={money}
            maxLegend={4}
            onSelect={cat => onOpenHistory(cat)}
            segments={allocationSegments}
          />
        </Card>

        <Card style={styles.card}>
          <SectionHeader
            action={
              summary.largest > 0 ? (
                <Muted style={styles.largestText}>Top {moneyExact(summary.largest)}</Muted>
              ) : undefined
            }
            title="Recent activity"
          />
          {recent.length === 0 ? (
            <EmptyState
              body="No payments for this selection yet. Tap + Add to log an entry."
              title="All clear"
            />
          ) : (
            recent.slice(0, 10).map((transaction, index) => (
              <React.Fragment key={transaction.id}>
                <TransactionRow onPress={openEditor} transaction={transaction} />
                {index < Math.min(recent.length, 10) - 1 ? (
                  <View style={styles.rowDivider} />
                ) : null}
              </React.Fragment>
            ))
          )}
        </Card>

        {capture.pending > 0 ? (
          <Muted style={styles.pendingNote}>
            {capture.pending} pending message{capture.pending === 1 ? '' : 's'} syncing…
          </Muted>
        ) : null}
      </ScrollView>

      <View style={styles.fabWrap}>
        <PrimaryButton
          gradient={colors.accentGradient}
          onPress={() => openEditor(null)}
          style={styles.fab}
          title="+ Add"
        />
      </View>

      <EditTransactionSheet
        onClose={() => setSheetOpen(false)}
        transaction={editing}
        visible={sheetOpen}
      />
    </>
  );
}

function useStyles(colors: Palette) {
  return React.useMemo(
    () =>
      StyleSheet.create({
        content: {
          padding: spacing.lg,
          paddingBottom: 96,
        },
        accountRow: {
          marginTop: spacing.xs,
        },
        heroCard: {
          marginBottom: spacing.lg,
          marginTop: spacing.sm,
        },
        heroTopRow: {
          alignItems: 'center',
          flexDirection: 'row',
          justifyContent: 'space-between',
        },
        heroKicker: {
          color: colors.textDim,
          fontSize: 11,
          fontWeight: '700',
          letterSpacing: 0.8,
        },
        pacePill: {
          borderRadius: radius.pill,
          paddingHorizontal: 10,
          paddingVertical: 3,
        },
        paceText: {
          fontSize: 11,
          fontWeight: '700',
        },
        heroAmount: {
          color: colors.text,
          fontSize: 40,
          fontWeight: '800',
          letterSpacing: -1,
          marginTop: 6,
        },
        heroSplit: {
          fontSize: 12,
          marginTop: 2,
        },
        budgetBlock: {
          marginTop: spacing.md,
        },
        budgetRow: {
          flexDirection: 'row',
          justifyContent: 'space-between',
          marginTop: 6,
        },
        budgetText: {
          fontSize: 12,
        },
        budgetPrompt: {
          marginTop: spacing.sm,
        },
        budgetPromptText: {
          fontSize: 12,
          fontWeight: '600',
        },
        statRow: {
          flexDirection: 'row',
          marginTop: spacing.lg,
        },
        statPress: {
          flex: 1,
        },
        statGap: {
          width: spacing.sm,
        },
        card: {
          marginBottom: spacing.lg,
        },
        linkText: {
          color: colors.accent,
          fontSize: 12,
          fontWeight: '700',
        },
        largestText: {
          fontSize: 12,
        },
        rowDivider: {
          backgroundColor: colors.border,
          height: StyleSheet.hairlineWidth,
          marginLeft: 50,
          opacity: 0.65,
        },
        pendingNote: {
          fontSize: 12,
          textAlign: 'center',
        },
        fabWrap: {
          bottom: spacing.lg,
          position: 'absolute',
          right: spacing.lg,
        },
        fab: {
          borderRadius: radius.pill,
          elevation: 8,
          minHeight: 46,
          paddingHorizontal: 22,
          shadowColor: colors.accentDeep,
          shadowOffset: {width: 0, height: 6},
          shadowOpacity: 0.35,
          shadowRadius: 12,
        },
      }),
    [colors],
  );
}
