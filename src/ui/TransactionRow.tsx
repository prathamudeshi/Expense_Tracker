import React from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';

import {categoryMeta} from '../core/categorize';
import {timeLabel} from '../core/dates';
import {moneyExact} from '../core/money';
import type {Transaction} from '../core/types';
import {radius, spacing, withAlpha, type Palette} from './theme';
import {useTheme} from './themeContext';

export function TransactionRow({
  transaction,
  onPress,
}: {
  transaction: Transaction;
  onPress: (transaction: Transaction) => void;
}) {
  const {colors} = useTheme();
  const styles = useStyles(colors);
  const isCredit = transaction.direction === 'CREDIT';
  const isInvestment = transaction.category === 'Investment' && !isCredit;
  const meta = categoryMeta(transaction.category);

  const rawCp = transaction.counterparty?.trim() || null;
  const rawNote = transaction.note?.trim() || null;

  let title: string;
  if (isInvestment) {
    title = 'Invest';
  } else if (rawCp) {
    title = rawCp;
  } else if (rawNote) {
    title = rawNote;
  } else if (isCredit) {
    title = 'Money received';
  } else {
    title = transaction.category;
  }

  const subParts: string[] = [meta.shortLabel];
  if (isInvestment) {
    if (rawNote && rawNote.toLowerCase() !== 'invest') {
      subParts.push(rawNote);
    } else if (rawCp && rawCp.toLowerCase() !== 'invest') {
      subParts.push(rawCp);
    } else if (Math.abs(transaction.amount - 2000) < 0.01) {
      subParts.push('SIP');
    }
  } else if (
    rawNote &&
    rawNote.toLowerCase() !== title.toLowerCase() &&
    rawNote.toLowerCase() !== 'invest'
  ) {
    subParts.push(rawNote);
  }

  if (transaction.paymentMode === 'CASH') {
    subParts.push('Cash');
  } else if (transaction.accountTail) {
    subParts.push(`••${transaction.accountTail}`);
  }
  subParts.push(timeLabel(transaction.occurredAt));

  return (
    <Pressable
      accessibilityHint="Opens transaction details"
      accessibilityLabel={`${title}, ${moneyExact(transaction.amount)}, ${transaction.category}`}
      accessibilityRole="button"
      onPress={() => onPress(transaction)}
      style={({pressed}) => [styles.row, {opacity: pressed ? 0.65 : 1}]}>
      <View
        style={[
          styles.badge,
          {
            backgroundColor: withAlpha(colors.accent, 0.1),
            borderColor: withAlpha(colors.accent, 0.22),
          },
        ]}>
        <Text style={[styles.badgeIcon, {color: colors.accent}]}>{meta.icon}</Text>
      </View>

      <View style={styles.middle}>
        <Text numberOfLines={1} style={styles.name}>
          {title}
        </Text>
        <Text numberOfLines={1} style={styles.meta}>
          {subParts.join(' · ')}
        </Text>
      </View>

      <View style={styles.right}>
        <Text
          style={[
            styles.amount,
            isCredit ? styles.amountCredit : null,
            isInvestment ? styles.amountInvest : null,
            transaction.excluded ? styles.amountExcluded : null,
          ]}>
          {isCredit ? '+' : isInvestment ? '' : '-'}
          {moneyExact(transaction.amount)}
        </Text>
        {isInvestment && !transaction.excluded ? (
          <View style={[styles.microPill, {backgroundColor: colors.accentSoft}]}>
            <Text style={[styles.microPillText, {color: colors.invest}]}>INVEST</Text>
          </View>
        ) : null}
        {transaction.excluded ? <Text style={styles.excludedTag}>excluded</Text> : null}
      </View>
    </Pressable>
  );
}

function useStyles(colors: Palette) {
  return React.useMemo(
    () =>
      StyleSheet.create({
        row: {
          alignItems: 'center',
          flexDirection: 'row',
          paddingVertical: 11,
        },
        badge: {
          alignItems: 'center',
          borderRadius: 12,
          borderWidth: 1,
          height: 38,
          justifyContent: 'center',
          marginRight: spacing.md,
          width: 38,
        },
        badgeIcon: {
          fontSize: 15,
          fontWeight: '700',
        },
        middle: {
          flex: 1,
          paddingRight: spacing.sm,
        },
        name: {
          color: colors.text,
          fontSize: 15,
          fontWeight: '600',
        },
        meta: {
          color: colors.textFaint,
          fontSize: 12,
          marginTop: 2,
        },
        right: {
          alignItems: 'flex-end',
        },
        amount: {
          color: colors.text,
          fontSize: 15,
          fontWeight: '700',
        },
        amountCredit: {
          color: colors.accent,
        },
        amountInvest: {
          color: colors.invest,
        },
        amountExcluded: {
          color: colors.textFaint,
          textDecorationLine: 'line-through',
        },
        microPill: {
          borderRadius: radius.pill,
          marginTop: 3,
          paddingHorizontal: 6,
          paddingVertical: 1,
        },
        microPillText: {
          fontSize: 9,
          fontWeight: '800',
          letterSpacing: 0.4,
        },
        excludedTag: {
          color: colors.textFaint,
          fontSize: 10,
          marginTop: 2,
        },
      }),
    [colors],
  );
}
