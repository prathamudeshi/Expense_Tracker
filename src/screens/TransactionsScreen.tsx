import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {dayHeading, monthLabel, monthRange} from '../core/dates';
import {money} from '../core/money';
import {listTransactions} from '../db/repository';
import type {Direction, Transaction} from '../core/types';
import {AccountPills, Chip, EmptyState, Muted, SegmentedControl} from '../ui/components';
import {TransactionRow} from '../ui/TransactionRow';
import {radius, spacing, withAlpha, type Palette} from '../ui/theme';
import {useTheme} from '../ui/themeContext';
import {useApp} from '../state/store';
import {EditTransactionSheet} from './EditTransactionSheet';

type Filter = 'ALL' | Direction | 'INVEST';

interface Section {
  title: string;
  spendTotal: number;
  investTotal: number;
  data: Transaction[];
}

export function TransactionsScreen() {
  const {colors} = useTheme();
  const styles = useStyles(colors);
  const {
    monthKey,
    modeFilter,
    setModeFilter,
    accountFilter,
    setAccountFilter,
    accounts,
    historyCategory,
    setHistoryCategory,
    version,
  } = useApp();

  const [rows, setRows] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('ALL');
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    if (historyCategory === 'Investment') {
      setFilter('INVEST');
    } else if (historyCategory) {
      setFilter('ALL');
    }
  }, [historyCategory]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const effectiveCategory =
        filter === 'INVEST' ? 'Investment' : historyCategory ?? undefined;
      const effectiveDirection =
        filter === 'INVEST' ? 'DEBIT' : filter === 'ALL' ? 'ALL' : filter;
      const excludeCategories =
        filter === 'DEBIT' && !historyCategory ? ['Investment'] : undefined;

      const result = await listTransactions({
        range: monthRange(monthKey),
        search,
        direction: effectiveDirection,
        mode: modeFilter,
        account: accountFilter,
        category: effectiveCategory,
        excludeCategories,
        limit: 1000,
      });
      setRows(result);
    } finally {
      setLoading(false);
    }
  }, [accountFilter, filter, historyCategory, modeFilter, monthKey, search]);

  useEffect(() => {
    load().catch(() => {});
  }, [load, version]);

  const sections = useMemo<Section[]>(() => {
    const buckets = new Map<string, Transaction[]>();
    for (const transaction of rows) {
      const heading = dayHeading(transaction.occurredAt);
      const existing = buckets.get(heading);
      if (existing) {
        existing.push(transaction);
      } else {
        buckets.set(heading, [transaction]);
      }
    }
    return Array.from(buckets.entries()).map(([title, data]) => ({
      title,
      data,
      spendTotal: data.reduce(
        (sum, item) =>
          item.direction === 'DEBIT' && !item.excluded && item.category !== 'Investment'
            ? sum + item.amount
            : sum,
        0,
      ),
      investTotal: data.reduce(
        (sum, item) =>
          item.direction === 'DEBIT' && !item.excluded && item.category === 'Investment'
            ? sum + item.amount
            : sum,
        0,
      ),
    }));
  }, [rows]);

  const visibleSpend = rows.reduce(
    (sum, item) =>
      item.direction === 'DEBIT' && !item.excluded && item.category !== 'Investment'
        ? sum + item.amount
        : sum,
    0,
  );
  const visibleInvest = rows.reduce(
    (sum, item) =>
      item.direction === 'DEBIT' && !item.excluded && item.category === 'Investment'
        ? sum + item.amount
        : sum,
    0,
  );

  const openEditor = (transaction: Transaction) => {
    setEditing(transaction);
    setSheetOpen(true);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.summaryLine}>
          <Muted style={styles.summaryText}>
            {monthLabel(monthKey)} · {rows.length} item{rows.length === 1 ? '' : 's'}
            {visibleSpend > 0 ? ` · ${money(visibleSpend)} spent` : ''}
            {visibleInvest > 0 ? ` · ${money(visibleInvest)} invest` : ''}
          </Muted>
        </View>

        <TextInput
          autoCapitalize="none"
          onChangeText={setSearch}
          placeholder="Search client, note, category or amount"
          placeholderTextColor={colors.textFaint}
          style={styles.search}
          value={search}
        />

        <View style={styles.filterRow}>
          <Chip
            label="All"
            onPress={() => {
              setHistoryCategory(null);
              setFilter('ALL');
            }}
            selected={filter === 'ALL' && !historyCategory}
          />
          <Chip
            label="Expenses"
            onPress={() => {
              setHistoryCategory(null);
              setFilter('DEBIT');
            }}
            selected={filter === 'DEBIT'}
          />
          <Chip
            label="Invest"
            onPress={() => {
              setHistoryCategory(null);
              setFilter('INVEST');
            }}
            selected={filter === 'INVEST'}
          />
          <Chip
            label="Income"
            onPress={() => {
              setHistoryCategory(null);
              setFilter('CREDIT');
            }}
            selected={filter === 'CREDIT'}
          />
          {historyCategory && historyCategory !== 'Investment' ? (
            <Pressable
              onPress={() => setHistoryCategory(null)}
              style={[styles.activeCatPill, {backgroundColor: withAlpha(colors.accent, 0.18)}]}>
              <Text style={[styles.activeCatText, {color: colors.accent}]}>
                {historyCategory} ✕
              </Text>
            </Pressable>
          ) : null}
        </View>

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
      </View>

      {loading && rows.length === 0 ? (
        <ActivityIndicator color={colors.accent} style={styles.loader} />
      ) : (
        <SectionList
          contentContainerStyle={styles.listContent}
          keyExtractor={item => String(item.id)}
          ListEmptyComponent={
            <EmptyState
              body="Nothing matches this month and filter. Try switching months or clearing filters."
              title="No transactions"
            />
          }
          renderItem={({item}) => <TransactionRow onPress={openEditor} transaction={item} />}
          renderSectionHeader={({section}) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              <Muted style={styles.sectionTotal}>
                {section.spendTotal > 0 ? money(section.spendTotal) : ''}
                {section.spendTotal > 0 && section.investTotal > 0 ? ' · ' : ''}
                {section.investTotal > 0 ? `${money(section.investTotal)} inv` : ''}
              </Muted>
            </View>
          )}
          sections={sections}
          stickySectionHeadersEnabled={false}
        />
      )}

      <EditTransactionSheet
        onClose={() => setSheetOpen(false)}
        transaction={editing}
        visible={sheetOpen}
      />
    </View>
  );
}

function useStyles(colors: Palette) {
  return React.useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
        },
        header: {
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.xs,
        },
        summaryLine: {
          marginBottom: spacing.sm,
        },
        summaryText: {
          fontSize: 12,
        },
        search: {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderRadius: radius.md,
          borderWidth: 1,
          color: colors.text,
          minHeight: 44,
          paddingHorizontal: spacing.md,
        },
        filterRow: {
          flexDirection: 'row',
          flexWrap: 'wrap',
          marginBottom: spacing.xs,
          marginTop: spacing.md,
        },
        accountRow: {
          marginTop: spacing.xs,
        },
        activeCatPill: {
          borderRadius: radius.pill,
          marginBottom: spacing.sm,
          marginRight: spacing.sm,
          paddingHorizontal: spacing.md,
          paddingVertical: 7,
        },
        activeCatText: {
          fontSize: 12,
          fontWeight: '700',
        },
        listContent: {
          paddingBottom: spacing.xxl,
          paddingHorizontal: spacing.lg,
        },
        sectionHeader: {
          alignItems: 'center',
          backgroundColor: colors.bg,
          flexDirection: 'row',
          justifyContent: 'space-between',
          paddingBottom: spacing.xs,
          paddingTop: spacing.lg,
        },
        sectionTitle: {
          color: colors.textDim,
          fontSize: 11,
          fontWeight: '700',
          letterSpacing: 0.6,
          textTransform: 'uppercase',
        },
        sectionTotal: {
          fontSize: 12,
        },
        loader: {
          marginTop: spacing.xxl,
        },
      }),
    [colors],
  );
}
