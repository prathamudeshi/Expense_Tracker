/**
 * Insights Dashboard: monochromatic dark-first executive analytics with
 * 1D / 1W / 1M / 3M / 6M / 1Y / All / Custom timeline selector, per-account
 * tracking, velocity & discipline metrics, time-of-day & ticket-tier profiles,
 * and AI-ready executive analyst briefs.
 */
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {categoryMeta} from '../core/categorize';
import {
  DAY_MS,
  dayHeading,
  dayKey,
  dayRange,
  monthLabelShort,
  parseCustomDateRange,
  trailingDaysRange,
  trailingMonthsRange,
  weekdayShort,
} from '../core/dates';
import {money, moneyCompact} from '../core/money';
import {
  categoryTotals,
  earliestTimestamp,
  incomeBreakdown,
  insightsDeepDive,
  investmentHoldings,
  listBankAccounts,
  monthlyTotals,
  peerSplitsSummary,
  periodSummary,
  routineSpots,
  topMerchants,
  weekdaySpend,
} from '../db/repository';
import type {
  BankAccountSummary,
  CategoryTotal,
  HabitSpot,
  IncomeBreakdown,
  InsightsDeepDive,
  InvestmentHolding,
  MerchantTotal,
  MonthTotal,
  PeerSplitItem,
  PeriodSummary,
} from '../core/types';
import type {Range} from '../core/dates';
import {
  AccountPills,
  BarList,
  Card,
  DualTrendChart,
  EmptyState,
  GradientSurface,
  Muted,
  ProgressBar,
  SectionHeader,
  SegmentedControl,
  StackedAllocationBar,
  StatTile,
  TrendChart,
  WeekdayStrip,
} from '../ui/components';
import {categoryColor, radius, spacing, withAlpha, type Palette} from '../ui/theme';
import {useTheme} from '../ui/themeContext';
import {useApp} from '../state/store';

type PeriodId = '1d' | '1w' | '1m' | '3m' | '6m' | '12m' | 'all' | 'custom';
type LensId = 'overview' | 'spending' | 'invest' | 'habits';

const PERIODS: Array<{id: PeriodId; label: string}> = [
  {id: '1d', label: '1D'},
  {id: '1w', label: '1W'},
  {id: '1m', label: '1M'},
  {id: '3m', label: '3M'},
  {id: '6m', label: '6M'},
  {id: '12m', label: '1Y'},
  {id: 'all', label: 'All'},
  {id: 'custom', label: 'Custom'},
];

const LENSES: Array<{value: LensId; label: string}> = [
  {value: 'overview', label: 'Overview'},
  {value: 'spending', label: 'Spending'},
  {value: 'invest', label: 'Invest'},
  {value: 'habits', label: 'Habits'},
];

const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];

const EMPTY_INCOME: IncomeBreakdown = {
  coreIncome: 0,
  reboundRefunds: 0,
  peerSplits: 0,
};

export function InsightsScreen({
  onOpenHistory,
}: {
  onOpenHistory?: (category?: string) => void;
}) {
  const {colors, mode} = useTheme();
  const styles = useStyles(colors);
  const {
    version,
    monthKey,
    setMonthKey,
    modeFilter,
    setModeFilter,
    accountFilter,
    setAccountFilter,
    accounts,
  } = useApp();

  const [period, setPeriod] = useState<PeriodId>('6m');
  const [lens, setLens] = useState<LensId>('overview');
  const [customFrom, setCustomFrom] = useState(() => {
    const d = new Date(Date.now() - 30 * DAY_MS);
    return dayKey(d);
  });
  const [customTo, setCustomTo] = useState(() => dayKey(new Date()));
  const [loading, setLoading] = useState(true);

  const [summary, setSummary] = useState<PeriodSummary | null>(null);
  const [months, setMonths] = useState<MonthTotal[]>([]);
  const [categories, setCategories] = useState<CategoryTotal[]>([]);
  const [merchants, setMerchants] = useState<MerchantTotal[]>([]);
  const [weekdays, setWeekdays] = useState<Array<{weekday: number; total: number}>>([]);
  const [holdings, setHoldings] = useState<InvestmentHolding[]>([]);
  const [incomeBreak, setIncomeBreak] = useState<IncomeBreakdown>(EMPTY_INCOME);
  const [spots, setSpots] = useState<HabitSpot[]>([]);
  const [peers, setPeers] = useState<PeerSplitItem[]>([]);
  const [deepDive, setDeepDive] = useState<InsightsDeepDive | null>(null);
  const [periodAccounts, setPeriodAccounts] = useState<BankAccountSummary[]>([]);

  const resolveRange = useCallback(async (): Promise<Range> => {
    switch (period) {
      case '1d':
        return dayRange(new Date());
      case '1w':
        return trailingDaysRange(7);
      case '1m':
        return trailingDaysRange(30);
      case '3m':
        return trailingMonthsRange(3);
      case '6m':
        return trailingMonthsRange(6);
      case '12m':
        return trailingMonthsRange(12);
      case 'custom': {
        const parsed = parseCustomDateRange(customFrom, customTo);
        return parsed ?? trailingDaysRange(30);
      }
      case 'all':
      default: {
        const first = await earliestTimestamp();
        return {from: first ?? Date.now() - 30 * DAY_MS, to: Date.now()};
      }
    }
  }, [customFrom, customTo, period]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const range = await resolveRange();

      const [
        nextSummary,
        nextMonths,
        nextCategories,
        nextMerchants,
        nextWeekdays,
        nextHoldings,
        nextIncomeBreak,
        nextSpots,
        nextPeers,
        nextDeepDive,
        nextPeriodAccounts,
      ] = await Promise.all([
        periodSummary(range, modeFilter, accountFilter),
        monthlyTotals(range, modeFilter, accountFilter),
        categoryTotals(range, modeFilter, false, accountFilter),
        topMerchants(range, 6, modeFilter, accountFilter),
        weekdaySpend(range, modeFilter, accountFilter),
        investmentHoldings(range, modeFilter, accountFilter),
        incomeBreakdown(range, modeFilter, accountFilter),
        routineSpots(range, modeFilter, 6, accountFilter),
        peerSplitsSummary(range, modeFilter, accountFilter),
        insightsDeepDive(range, modeFilter, accountFilter),
        listBankAccounts(range, modeFilter),
      ]);

      setSummary(nextSummary);
      setMonths(nextMonths);
      setCategories(nextCategories);
      setMerchants(nextMerchants);
      setWeekdays(nextWeekdays);
      setHoldings(nextHoldings);
      setIncomeBreak(nextIncomeBreak);
      setSpots(nextSpots);
      setPeers(nextPeers);
      setDeepDive(nextDeepDive);
      setPeriodAccounts(nextPeriodAccounts);
    } finally {
      setLoading(false);
    }
  }, [accountFilter, modeFilter, resolveRange]);

  useEffect(() => {
    load().catch(() => {});
  }, [load, version]);

  const monthsActive = Math.max(
    1,
    months.filter(m => m.spend > 0 || m.invested > 0).length,
  );
  const spendTotal = summary?.spend ?? 0;
  const investTotal = summary?.invested ?? 0;
  const incomeTotal = summary?.income ?? 0;
  const monthlyAvgInvest = investTotal / monthsActive;
  const investRate =
    incomeTotal > 0 ? Math.round((investTotal / incomeTotal) * 100) : 0;
  const investToSpend =
    spendTotal > 0 ? (investTotal / spendTotal).toFixed(1) : '0.0';
  const surplus = Math.max(0, incomeTotal - spendTotal - investTotal);

  const flowSegments = useMemo(
    () => [
      {
        key: 'spend',
        label: 'Living Spend',
        value: spendTotal,
        color: colors.accentDeep,
      },
      {
        key: 'invest',
        label: 'Invest',
        value: investTotal,
        color: colors.invest,
      },
      ...(surplus > 0
        ? [
            {
              key: 'surplus',
              label: 'Retained',
              value: surplus,
              color: colors.textDim,
            },
          ]
        : []),
    ],
    [colors.accentDeep, colors.invest, colors.textDim, investTotal, spendTotal, surplus],
  );

  const dualTrendItems = useMemo(
    () =>
      months.map(item => ({
        key: item.monthKey,
        label: monthLabelShort(item.monthKey),
        spend: item.spend,
        invested: item.invested,
      })),
    [months],
  );

  const selectedMonthData = useMemo(
    () => months.find(m => m.monthKey === monthKey) ?? months[months.length - 1] ?? null,
    [monthKey, months],
  );

  const categorySegments = useMemo(
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

  const categoryBars = useMemo(
    () =>
      categories.map(item => ({
        key: item.category,
        label: `${categoryMeta(item.category).icon}  ${item.category} (${item.count})`,
        value: item.total,
        color: categoryColor(item.category, mode),
      })),
    [categories, mode],
  );

  const merchantBars = useMemo(
    () =>
      merchants.map(item => ({
        key: item.counterparty,
        label: `${item.counterparty} (${item.count})`,
        value: item.total,
        gradient: colors.accentGradient,
      })),
    [colors.accentGradient, merchants],
  );

  const weekdayItems = useMemo(() => {
    const lookup = new Map(weekdays.map(item => [item.weekday, item.total]));
    return WEEKDAY_ORDER.map(day => ({
      key: String(day),
      label: weekdayShort(new Date(2024, 0, 7 + day).getTime()).slice(0, 3),
      value: lookup.get(day) ?? 0,
    }));
  }, [weekdays]);

  const investTrendItems = useMemo(
    () =>
      months.map(item => ({
        key: item.monthKey,
        label: monthLabelShort(item.monthKey),
        value: item.invested,
      })),
    [months],
  );

  const timeSlotBars = useMemo(
    () =>
      (deepDive?.timeSlots ?? []).map(slot => ({
        key: slot.key,
        label: `${slot.label} (${slot.window}) · ${slot.count}x`,
        value: slot.spend,
        color: colors.accent,
      })),
    [colors.accent, deepDive?.timeSlots],
  );

  const ticketTierBars = useMemo(
    () =>
      (deepDive?.ticketTiers ?? []).map(tier => ({
        key: tier.key,
        label: `${tier.label} · ${tier.count} txns`,
        value: tier.spend,
        color: colors.invest,
      })),
    [colors.invest, deepDive?.ticketTiers],
  );

  if (loading && !summary) {
    return <ActivityIndicator color={colors.accent} style={styles.loader} />;
  }

  const hasData = (summary?.count ?? 0) > 0;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {/* Scrollable Timeline Selector: 1D / 1W / 1M / 3M / 6M / 1Y / All / Custom */}
      <ScrollView
        contentContainerStyle={styles.periodScroll}
        horizontal
        showsHorizontalScrollIndicator={false}>
        {PERIODS.map(item => {
          const active = period === item.id;
          return (
            <Pressable
              key={item.id}
              onPress={() => setPeriod(item.id)}
              style={[
                styles.periodPill,
                active
                  ? {backgroundColor: colors.accentDeep, borderColor: colors.accentDeep}
                  : null,
              ]}>
              <Text style={[styles.periodPillText, active ? {color: colors.onAccent} : null]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Custom Date Range Picker */}
      {period === 'custom' ? (
        <Card style={styles.customRangeCard}>
          <View style={styles.customInputRow}>
            <View style={styles.customField}>
              <Text style={styles.customLabel}>FROM (YYYY-MM-DD)</Text>
              <TextInput
                autoCapitalize="none"
                onChangeText={setCustomFrom}
                placeholder="2026-10-01"
                placeholderTextColor={colors.textFaint}
                style={styles.customInput}
                value={customFrom}
              />
            </View>
            <View style={styles.gap} />
            <View style={styles.customField}>
              <Text style={styles.customLabel}>TO (YYYY-MM-DD)</Text>
              <TextInput
                autoCapitalize="none"
                onChangeText={setCustomTo}
                placeholder="2026-11-16"
                placeholderTextColor={colors.textFaint}
                style={styles.customInput}
                value={customTo}
              />
            </View>
          </View>
          <View style={styles.presetRow}>
            {[
              {label: 'Last 14D', from: dayKey(new Date(Date.now() - 13 * DAY_MS)), to: dayKey(new Date())},
              {label: 'Nov 2026', from: '2026-11-01', to: '2026-11-30'},
              {label: 'Oct 2026', from: '2026-10-01', to: '2026-10-31'},
              {label: 'Sep 2026', from: '2026-09-01', to: '2026-09-30'},
            ].map(preset => (
              <Pressable
                key={preset.label}
                onPress={() => {
                  setCustomFrom(preset.from);
                  setCustomTo(preset.to);
                }}
                style={styles.presetChip}>
                <Text style={styles.presetChipText}>{preset.label}</Text>
              </Pressable>
            ))}
          </View>
        </Card>
      ) : null}

      {/* Mode & Multi-Account Filters */}
      <View style={styles.filterRow}>
        <View style={styles.flex1}>
          <SegmentedControl
            onChange={setModeFilter}
            options={[
              {value: 'ALL', label: 'Combined'},
              {value: 'UPI', label: 'UPI'},
              {value: 'CASH', label: 'Cash'},
            ]}
            value={modeFilter}
          />
        </View>
      </View>

      {accounts.length > 0 ? (
        <View style={styles.accountStrip}>
          <AccountPills
            accounts={accounts}
            onChange={setAccountFilter}
            value={accountFilter}
          />
        </View>
      ) : null}

      <View style={styles.lensWrap}>
        <SegmentedControl onChange={setLens} options={LENSES} value={lens} />
      </View>

      {!hasData ? (
        <EmptyState
          body="No transactions match this timeline and account filter. Try a wider timeline or switch accounts."
          title="No data in range"
        />
      ) : null}

      {/* ---- LENS 1: OVERVIEW ---- */}
      {hasData && lens === 'overview' ? (
        <View style={styles.sectionStack}>
          <GradientSurface
            colors={colors.heroGradient}
            glowColor={colors.accent}
            style={styles.card}>
            <SectionHeader
              action={
                <View style={[styles.badgePill, {backgroundColor: colors.accentSoft}]}>
                  <Text style={[styles.badgeText, {color: colors.invest}]}>
                    {investRate}% invested
                  </Text>
                </View>
              }
              title="Capital allocation"
            />
            <StackedAllocationBar
              formatValue={money}
              maxLegend={3}
              segments={flowSegments}
            />

            <View style={styles.bentoGrid}>
              <View style={styles.bentoRow}>
                <StatTile
                  bg={withAlpha(colors.accent, 0.1)}
                  label="Living Spend"
                  subtitle={`${money(deepDive?.dailyBurnRate ?? 0)}/day burn`}
                  value={money(spendTotal)}
                />
                <View style={styles.gap} />
                <StatTile
                  bg={withAlpha(colors.accent, 0.14)}
                  label="Invest"
                  subtitle={`${investToSpend}x living spend`}
                  tone={colors.invest}
                  value={money(investTotal)}
                />
              </View>
              <View style={[styles.bentoRow, styles.bentoGap]}>
                <StatTile
                  bg={withAlpha(colors.text, 0.05)}
                  label="Core Income"
                  tone={colors.accent}
                  value={money(incomeBreak.coreIncome)}
                />
                <View style={styles.gap} />
                <StatTile
                  bg={withAlpha(colors.text, 0.05)}
                  label="Splits & Refunds"
                  value={`+${money(incomeBreak.peerSplits + incomeBreak.reboundRefunds)}`}
                />
              </View>
            </View>
          </GradientSurface>

          {/* Velocity & Discipline Pulse */}
          {deepDive ? (
            <Card style={styles.card}>
              <SectionHeader
                action={
                  <Muted style={styles.microLabel}>
                    {deepDive.activeDays}/{deepDive.totalDaysInPeriod} active days
                  </Muted>
                }
                title="Velocity & discipline"
              />
              <View style={styles.bentoRow}>
                <StatTile
                  label="30-Day Pace"
                  value={money(deepDive.projected30d)}
                />
                <View style={styles.gap} />
                <StatTile
                  label="Avg Ticket"
                  value={money(deepDive.avgTicket)}
                />
                <View style={styles.gap} />
                <StatTile
                  label="No-Spend Days"
                  tone={colors.invest}
                  value={String(deepDive.zeroSpendDays)}
                />
              </View>
            </Card>
          ) : null}

          {/* Smart Analyst Briefs (AI-Ready) */}
          {deepDive && deepDive.briefs.length > 0 ? (
            <Card style={styles.card}>
              <SectionHeader
                action={<Muted style={styles.microLabel}>On-device intelligence</Muted>}
                title="Smart analyst"
              />
              {deepDive.briefs.map((b, idx) => (
                <React.Fragment key={b.id}>
                  <View style={styles.briefRow}>
                    <View style={styles.briefTop}>
                      <Text style={styles.briefTitle}>{b.title}</Text>
                      <View style={[styles.briefBadge, {backgroundColor: colors.accentSoft}]}>
                        <Text style={[styles.briefBadgeText, {color: colors.invest}]}>
                          {b.metric}
                        </Text>
                      </View>
                    </View>
                    <Muted style={styles.briefDetail}>{b.detail}</Muted>
                  </View>
                  {idx < deepDive.briefs.length - 1 ? <View style={styles.rowDivider} /> : null}
                </React.Fragment>
              ))}
            </Card>
          ) : null}

          {/* Spend vs Invested Monthly Trend */}
          {dualTrendItems.length > 0 ? (
            <Card style={styles.card}>
              <SectionHeader
                action={
                  selectedMonthData && onOpenHistory ? (
                    <Pressable
                      onPress={() => {
                        setMonthKey(selectedMonthData.monthKey);
                        onOpenHistory();
                      }}>
                      <Text style={[styles.linkText, {color: colors.accent}]}>
                        Open {monthLabelShort(selectedMonthData.monthKey)} →
                      </Text>
                    </Pressable>
                  ) : undefined
                }
                title="Monthly trajectory"
              />
              <DualTrendChart
                formatValue={moneyCompact}
                items={dualTrendItems}
                onSelect={setMonthKey}
                selectedKey={selectedMonthData?.monthKey}
              />
              {selectedMonthData ? (
                <View style={[styles.monthCallout, {backgroundColor: colors.surfaceAlt}]}>
                  <Text style={styles.monthCalloutTitle}>
                    {monthLabelShort(selectedMonthData.monthKey)}
                  </Text>
                  <Muted style={styles.monthCalloutMeta}>
                    Spend {money(selectedMonthData.spend)} · Invest{' '}
                    {money(selectedMonthData.invested)} · In {money(selectedMonthData.income)}
                  </Muted>
                </View>
              ) : null}
            </Card>
          ) : null}

          {/* Multi-Bank Account Breakdown */}
          {periodAccounts.length > 0 ? (
            <Card style={styles.card}>
              <SectionHeader
                action={<Muted style={styles.microLabel}>Tap to isolate</Muted>}
                title="Bank accounts"
              />
              {periodAccounts.map((acc, idx) => {
                const selected = accountFilter === acc.accountTail;
                return (
                  <React.Fragment key={acc.accountTail}>
                    <Pressable
                      onPress={() =>
                        setAccountFilter(selected ? 'ALL' : acc.accountTail)
                      }
                      style={[
                        styles.accountCardRow,
                        selected
                          ? {
                              backgroundColor: colors.accentSoft,
                              borderRadius: radius.sm,
                              paddingHorizontal: spacing.sm,
                            }
                          : null,
                      ]}>
                      <View style={styles.flex1}>
                        <Text style={styles.accountName}>
                          {acc.label} ({acc.count})
                        </Text>
                        <Muted style={styles.accountSub}>
                          Spend {money(acc.spend)} · Invest {money(acc.invested)} · In{' '}
                          {money(acc.income)}
                        </Muted>
                      </View>
                      <Text style={[styles.accountSpend, {color: colors.accent}]}>
                        {money(acc.spend)}
                      </Text>
                    </Pressable>
                    {idx < periodAccounts.length - 1 ? <View style={styles.rowDivider} /> : null}
                  </React.Fragment>
                );
              })}
            </Card>
          ) : null}
        </View>
      ) : null}

      {/* ---- LENS 2: SPENDING ---- */}
      {hasData && lens === 'spending' ? (
        <View style={styles.sectionStack}>
          <Card style={styles.card}>
            <SectionHeader
              action={<Muted style={styles.microLabel}>{money(spendTotal)} total</Muted>}
              title="Category mix"
            />
            <StackedAllocationBar
              formatValue={money}
              maxLegend={6}
              onSelect={cat => onOpenHistory?.(cat)}
              segments={categorySegments}
            />
            <View style={styles.dividerSpace} />
            <BarList formatValue={money} items={categoryBars} />
          </Card>

          <Card style={styles.card}>
            <SectionHeader title="Time-of-day profile" />
            <BarList formatValue={money} items={timeSlotBars} />
          </Card>

          <Card style={styles.card}>
            <SectionHeader title="Ticket size structure" />
            <BarList formatValue={money} items={ticketTierBars} />
          </Card>

          <Card style={styles.card}>
            <SectionHeader title="Weekly rhythm" />
            <WeekdayStrip formatValue={money} items={weekdayItems} />
          </Card>

          <Card style={styles.card}>
            <SectionHeader title="Top clients & merchants" />
            {merchantBars.length === 0 ? (
              <Muted>No named merchants in this range.</Muted>
            ) : (
              <BarList formatValue={money} items={merchantBars} />
            )}
          </Card>

          {/* Largest Single Spends (Outliers) */}
          {deepDive && deepDive.topOutliers.length > 0 ? (
            <Card style={styles.card}>
              <SectionHeader title="Largest single spends" />
              {deepDive.topOutliers.map((t, idx) => (
                <React.Fragment key={t.id}>
                  <View style={styles.outlierRow}>
                    <View style={styles.flex1}>
                      <Text style={styles.outlierName}>
                        {t.counterparty || t.note || t.category}
                      </Text>
                      <Muted style={styles.outlierSub}>
                        {t.category}
                        {t.note && t.note !== t.counterparty ? ` · ${t.note}` : ''} ·{' '}
                        {dayHeading(t.occurredAt)}
                      </Muted>
                    </View>
                    <Text style={styles.outlierAmount}>{money(t.amount)}</Text>
                  </View>
                  {idx < deepDive.topOutliers.length - 1 ? (
                    <View style={styles.rowDivider} />
                  ) : null}
                </React.Fragment>
              ))}
            </Card>
          ) : null}
        </View>
      ) : null}

      {/* ---- LENS 3: INVEST ---- */}
      {hasData && lens === 'invest' ? (
        <View style={styles.sectionStack}>
          <GradientSurface
            colors={colors.heroGradient}
            glowColor={colors.accent}
            style={styles.card}>
            <Text style={styles.kicker}>TOTAL INVESTED (NAMED AS INVEST)</Text>
            <Text style={[styles.investHeroNum, {color: colors.invest}]}>
              {money(investTotal)}
            </Text>

            <View style={styles.bentoRow}>
              <StatTile
                bg={withAlpha(colors.accent, 0.12)}
                label="Monthly Avg"
                tone={colors.invest}
                value={money(monthlyAvgInvest)}
              />
              <View style={styles.gap} />
              <StatTile
                bg={withAlpha(colors.text, 0.05)}
                label="vs Spend"
                value={`${investToSpend}x`}
              />
              <View style={styles.gap} />
              <StatTile
                bg={withAlpha(colors.text, 0.05)}
                label="Orders"
                value={String(summary?.investmentCount ?? 0)}
              />
            </View>

            {incomeBreak.reboundRefunds > 0 ? (
              <View style={[styles.refundStrip, {backgroundColor: colors.accentSoft}]}>
                <Muted style={styles.refundText}>
                  IPO / Merchant refunds: {money(incomeBreak.reboundRefunds)} · Net deployed:{' '}
                  {money(Math.max(0, investTotal - incomeBreak.reboundRefunds))}
                </Muted>
              </View>
            ) : null}
          </GradientSurface>

          <Card style={styles.card}>
            <SectionHeader
              action={
                onOpenHistory ? (
                  <Pressable onPress={() => onOpenHistory('Investment')}>
                    <Text style={[styles.linkText, {color: colors.accent}]}>View ledger →</Text>
                  </Pressable>
                ) : undefined
              }
              title="Allocations & notes"
            />
            {holdings.length === 0 ? (
              <Muted>
                No investments recorded in this range. Any investment is standardized under Invest.
              </Muted>
            ) : (
              holdings.map((h, idx) => {
                const maxHold = holdings[0]?.total ?? 1;
                return (
                  <React.Fragment key={h.name}>
                    <View style={styles.holdingBlock}>
                      <View style={styles.holdingRow}>
                        <View style={[styles.holdingDot, {backgroundColor: colors.invest}]} />
                        <View style={styles.holdingMeta}>
                          <Text style={styles.holdingName}>{h.name}</Text>
                          <Muted style={styles.holdingSub}>
                            {h.count} order{h.count === 1 ? '' : 's'} · Last {dayHeading(h.lastAt)}
                          </Muted>
                        </View>
                        <Text style={[styles.holdingValue, {color: colors.invest}]}>
                          {money(h.total)}
                        </Text>
                      </View>
                      <ProgressBar
                        height={5}
                        ratio={h.total / maxHold}
                        tint={colors.accent}
                      />
                    </View>
                    {idx < holdings.length - 1 ? <View style={styles.rowDivider} /> : null}
                  </React.Fragment>
                );
              })
            )}
          </Card>

          <Card style={styles.card}>
            <SectionHeader title="Monthly deployment" />
            {investTrendItems.length === 0 ? (
              <Muted>No monthly investment history.</Muted>
            ) : (
              <TrendChart
                formatValue={moneyCompact}
                items={investTrendItems}
                onSelect={setMonthKey}
                selectedKey={selectedMonthData?.monthKey}
                tint={colors.invest}
              />
            )}
          </Card>
        </View>
      ) : null}

      {/* ---- LENS 4: HABITS & SPLITS ---- */}
      {hasData && lens === 'habits' ? (
        <View style={styles.sectionStack}>
          <Card style={styles.card}>
            <SectionHeader
              action={<Muted style={styles.microLabel}>2+ visits</Muted>}
              title="Frequent clients"
            />
            {spots.length === 0 ? (
              <Muted>No repeat clients yet in this range.</Muted>
            ) : (
              spots.map((spot, idx) => {
                const meta = categoryMeta(spot.category);
                return (
                  <React.Fragment key={spot.name}>
                    <View style={styles.habitRow}>
                      <View
                        style={[
                          styles.habitIconBox,
                          {
                            backgroundColor: withAlpha(colors.accent, 0.1),
                            borderColor: withAlpha(colors.accent, 0.22),
                          },
                        ]}>
                        <Text style={[styles.habitIcon, {color: colors.accent}]}>{meta.icon}</Text>
                      </View>
                      <View style={styles.habitMeta}>
                        <Text style={styles.habitName}>{spot.name}</Text>
                        <Muted style={styles.habitSub}>
                          {spot.category} · {spot.count} visits · avg {money(spot.avgTicket)}
                        </Muted>
                      </View>
                      <Text style={styles.habitTotal}>{money(spot.total)}</Text>
                    </View>
                    {idx < spots.length - 1 ? <View style={styles.rowDivider} /> : null}
                  </React.Fragment>
                );
              })
            )}
          </Card>

          <Card style={styles.card}>
            <SectionHeader
              action={<Muted style={styles.microLabel}>P2P balance</Muted>}
              title="Friends & splits"
            />
            {peers.length === 0 ? (
              <Muted>No peer-to-peer splits found in this range.</Muted>
            ) : (
              peers.map((peer, idx) => (
                <React.Fragment key={peer.person}>
                  <View style={styles.peerRow}>
                    <View style={styles.peerMeta}>
                      <Text style={styles.peerName}>{peer.person}</Text>
                      <Muted style={styles.peerSub}>
                        In {money(peer.received)} · Out {money(peer.paid)} ({peer.count} txns)
                      </Muted>
                    </View>
                    <Text
                      style={[
                        styles.peerNet,
                        {
                          color:
                            peer.net > 0
                              ? colors.invest
                              : peer.net < 0
                                ? colors.text
                                : colors.textDim,
                        },
                      ]}>
                      {peer.net > 0 ? '+' : ''}
                      {money(peer.net)}
                    </Text>
                  </View>
                  {idx < peers.length - 1 ? <View style={styles.rowDivider} /> : null}
                </React.Fragment>
              ))
            )}
          </Card>
        </View>
      ) : null}
    </ScrollView>
  );
}

function useStyles(colors: Palette) {
  return React.useMemo(
    () =>
      StyleSheet.create({
        content: {
          padding: spacing.lg,
          paddingBottom: spacing.xxl,
        },
        periodScroll: {
          gap: 6,
          paddingBottom: spacing.sm,
        },
        periodPill: {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: radius.pill,
          borderWidth: 1,
          marginRight: 6,
          paddingHorizontal: 13,
          paddingVertical: 6,
        },
        periodPillText: {
          color: colors.textDim,
          fontSize: 12,
          fontWeight: '700',
        },
        customRangeCard: {
          marginBottom: spacing.sm,
          padding: spacing.md,
        },
        customInputRow: {
          flexDirection: 'row',
        },
        customField: {
          flex: 1,
        },
        customLabel: {
          color: colors.textDim,
          fontSize: 10,
          fontWeight: '700',
          letterSpacing: 0.5,
          marginBottom: 4,
        },
        customInput: {
          backgroundColor: colors.surfaceAlt,
          borderColor: colors.border,
          borderRadius: radius.sm,
          borderWidth: 1,
          color: colors.text,
          fontSize: 13,
          minHeight: 38,
          paddingHorizontal: spacing.sm,
        },
        presetRow: {
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 6,
          marginTop: spacing.sm,
        },
        presetChip: {
          backgroundColor: colors.surfaceAlt,
          borderColor: colors.border,
          borderRadius: radius.pill,
          borderWidth: 1,
          paddingHorizontal: 10,
          paddingVertical: 4,
        },
        presetChipText: {
          color: colors.accent,
          fontSize: 11,
          fontWeight: '600',
        },
        filterRow: {
          flexDirection: 'row',
          marginTop: 2,
        },
        flex1: {
          flex: 1,
        },
        accountStrip: {
          marginTop: spacing.xs,
        },
        lensWrap: {
          marginTop: spacing.sm,
        },
        sectionStack: {
          marginTop: spacing.md,
        },
        card: {
          marginBottom: spacing.lg,
        },
        badgePill: {
          borderRadius: radius.pill,
          paddingHorizontal: 10,
          paddingVertical: 3,
        },
        badgeText: {
          fontSize: 11,
          fontWeight: '700',
        },
        bentoGrid: {
          marginTop: spacing.lg,
        },
        bentoRow: {
          flexDirection: 'row',
        },
        bentoGap: {
          marginTop: spacing.sm,
        },
        gap: {
          width: spacing.sm,
        },
        linkText: {
          fontSize: 12,
          fontWeight: '700',
        },
        microLabel: {
          fontSize: 12,
        },
        briefRow: {
          paddingVertical: 10,
        },
        briefTop: {
          alignItems: 'center',
          flexDirection: 'row',
          justifyContent: 'space-between',
          marginBottom: 4,
        },
        briefTitle: {
          color: colors.text,
          fontSize: 14,
          fontWeight: '700',
        },
        briefBadge: {
          borderRadius: radius.pill,
          paddingHorizontal: 8,
          paddingVertical: 2,
        },
        briefBadgeText: {
          fontSize: 11,
          fontWeight: '700',
        },
        briefDetail: {
          fontSize: 12,
        },
        monthCallout: {
          alignItems: 'center',
          borderRadius: radius.md,
          flexDirection: 'row',
          justifyContent: 'space-between',
          marginTop: spacing.md,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
        },
        monthCalloutTitle: {
          color: colors.text,
          fontSize: 12,
          fontWeight: '700',
        },
        monthCalloutMeta: {
          fontSize: 12,
        },
        accountCardRow: {
          alignItems: 'center',
          flexDirection: 'row',
          justifyContent: 'space-between',
          paddingVertical: 10,
        },
        accountName: {
          color: colors.text,
          fontSize: 14,
          fontWeight: '600',
        },
        accountSub: {
          fontSize: 12,
          marginTop: 2,
        },
        accountSpend: {
          fontSize: 15,
          fontWeight: '700',
        },
        dividerSpace: {
          height: spacing.lg,
        },
        outlierRow: {
          alignItems: 'center',
          flexDirection: 'row',
          justifyContent: 'space-between',
          paddingVertical: 10,
        },
        outlierName: {
          color: colors.text,
          fontSize: 14,
          fontWeight: '600',
        },
        outlierSub: {
          fontSize: 12,
          marginTop: 2,
        },
        outlierAmount: {
          color: colors.text,
          fontSize: 15,
          fontWeight: '700',
        },
        kicker: {
          color: colors.textDim,
          fontSize: 11,
          fontWeight: '700',
          letterSpacing: 0.8,
        },
        investHeroNum: {
          fontSize: 36,
          fontWeight: '800',
          letterSpacing: -0.8,
          marginBottom: spacing.md,
          marginTop: 4,
        },
        refundStrip: {
          borderRadius: radius.md,
          marginTop: spacing.md,
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
        },
        refundText: {
          fontSize: 12,
        },
        holdingBlock: {
          paddingVertical: 10,
        },
        holdingRow: {
          alignItems: 'center',
          flexDirection: 'row',
          marginBottom: 6,
        },
        holdingDot: {
          borderRadius: radius.pill,
          height: 8,
          marginRight: spacing.md,
          width: 8,
        },
        holdingMeta: {
          flex: 1,
          paddingRight: spacing.sm,
        },
        holdingName: {
          color: colors.text,
          fontSize: 15,
          fontWeight: '600',
        },
        holdingSub: {
          fontSize: 12,
          marginTop: 2,
        },
        holdingValue: {
          fontSize: 15,
          fontWeight: '700',
        },
        rowDivider: {
          backgroundColor: colors.border,
          height: StyleSheet.hairlineWidth,
          opacity: 0.65,
        },
        habitRow: {
          alignItems: 'center',
          flexDirection: 'row',
          paddingVertical: 10,
        },
        habitIconBox: {
          alignItems: 'center',
          borderRadius: 11,
          borderWidth: 1,
          height: 36,
          justifyContent: 'center',
          marginRight: spacing.md,
          width: 36,
        },
        habitIcon: {
          fontSize: 14,
          fontWeight: '700',
        },
        habitMeta: {
          flex: 1,
          paddingRight: spacing.sm,
        },
        habitName: {
          color: colors.text,
          fontSize: 14,
          fontWeight: '600',
        },
        habitSub: {
          fontSize: 12,
          marginTop: 1,
        },
        habitTotal: {
          color: colors.text,
          fontSize: 14,
          fontWeight: '700',
        },
        peerRow: {
          alignItems: 'center',
          flexDirection: 'row',
          justifyContent: 'space-between',
          paddingVertical: 10,
        },
        peerMeta: {
          flex: 1,
          paddingRight: spacing.sm,
        },
        peerName: {
          color: colors.text,
          fontSize: 15,
          fontWeight: '600',
        },
        peerSub: {
          fontSize: 12,
          marginTop: 1,
        },
        peerNet: {
          fontSize: 15,
          fontWeight: '700',
        },
        loader: {
          marginTop: spacing.xxl,
        },
      }),
    [colors],
  );
}
