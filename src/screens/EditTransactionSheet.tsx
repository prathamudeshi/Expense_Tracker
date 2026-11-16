/**
 * Transaction editor / quick-entry sheet supporting Expense, Investment ("Invest"),
 * and Income flows, multi-account selection, live classification, and "Forever
 * Client Rules" that apply retroactively across history.
 */
import React, {useEffect, useMemo, useState} from 'react';
import {Alert, StyleSheet, Text, View} from 'react-native';

import {CATEGORIES, categoryMeta, guessCategory} from '../core/categorize';
import {dayHeading, timeLabel} from '../core/dates';
import {parseAmount} from '../core/money';
import type {Direction, PaymentMode, Transaction} from '../core/types';
import {upsertCategoryRule} from '../db/repository';
import {
  Chip,
  Divider,
  Field,
  GhostButton,
  Label,
  Muted,
  PrimaryButton,
  Sheet,
  ToggleRow,
} from '../ui/components';
import {radius, spacing, type Palette} from '../ui/theme';
import {useTheme} from '../ui/themeContext';
import {useApp} from '../state/store';

interface Props {
  visible: boolean;
  transaction: Transaction | null;
  onClose: () => void;
}

type EntryKind = 'EXPENSE' | 'INVEST' | 'INCOME';

export function EditTransactionSheet({visible, transaction, onClose}: Props) {
  const {colors} = useTheme();
  const styles = useStyles(colors);
  const {addManual, patchTransaction, removeTransaction, accounts, reload} = useApp();
  const isNew = transaction === null;

  const [amount, setAmount] = useState('');
  const [counterparty, setCounterparty] = useState('');
  const [note, setNote] = useState('');
  const [accountTail, setAccountTail] = useState('');
  const [category, setCategory] = useState<string>('Other');
  const [direction, setDirection] = useState<Direction>('DEBIT');
  const [entryKind, setEntryKind] = useState<EntryKind>('EXPENSE');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('CASH');
  const [excluded, setExcluded] = useState(false);
  const [saveForever, setSaveForever] = useState(false);
  const [lockNoteForever, setLockNoteForever] = useState(false);
  const [manualCategoryPicked, setManualCategoryPicked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  const knownTails = useMemo(
    () =>
      accounts
        .map(a => a.accountTail)
        .filter(tail => tail && tail !== 'UNLINKED'),
    [accounts],
  );

  useEffect(() => {
    if (!visible) {
      return;
    }
    const dir = transaction?.direction ?? 'DEBIT';
    const cat = transaction?.category ?? 'Other';
    const kind: EntryKind =
      dir === 'CREDIT' ? 'INCOME' : cat === 'Investment' ? 'INVEST' : 'EXPENSE';

    setAmount(transaction ? String(transaction.amount) : '');
    setCounterparty(
      kind === 'INVEST' ? 'Invest' : transaction?.counterparty ?? '',
    );
    setNote(transaction?.note ?? '');
    setAccountTail(
      transaction?.accountTail ?? (knownTails[0] ?? ''),
    );
    setCategory(cat);
    setDirection(dir);
    setEntryKind(kind);
    setPaymentMode(transaction?.paymentMode ?? 'CASH');
    setExcluded(transaction?.excluded ?? false);
    setSaveForever(false);
    setLockNoteForever(false);
    setManualCategoryPicked(Boolean(transaction?.categoryLocked));
    setShowRaw(false);
    setSaving(false);
  }, [knownTails, transaction, visible]);

  const meta = useMemo(() => {
    if (!transaction) {
      return null;
    }
    const parts: string[] = [
      `${dayHeading(transaction.occurredAt)} · ${timeLabel(transaction.occurredAt)}`,
    ];
    if (transaction.instrument) {
      parts.push(transaction.instrument);
    }
    if (transaction.accountTail) {
      parts.push(`A/c ••${transaction.accountTail}`);
    }
    if (transaction.upiRef) {
      parts.push(`Ref ${transaction.upiRef}`);
    }
    return parts.join('  ·  ');
  }, [transaction]);

  const applyEntryKind = (kind: EntryKind) => {
    setEntryKind(kind);
    if (kind === 'INVEST') {
      setDirection('DEBIT');
      setCategory('Investment');
      if (counterparty.trim() && counterparty.trim().toLowerCase() !== 'invest' && !note.trim()) {
        setNote(counterparty.trim());
      }
      setCounterparty('Invest');
      setManualCategoryPicked(true);
      if (isNew && paymentMode === 'CASH') {
        setPaymentMode('UPI');
      }
    } else if (kind === 'INCOME') {
      setDirection('CREDIT');
      if (category === 'Other' || category === 'Investment') {
        setCategory('Income');
      }
      if (counterparty === 'Invest') {
        setCounterparty('');
      }
    } else {
      setDirection('DEBIT');
      if (counterparty === 'Invest') {
        setCounterparty('');
      }
      if (category === 'Investment' || category === 'Income') {
        const guessed = guessCategory(
          counterparty.trim() || null,
          null,
          'DEBIT',
          [],
          note.trim() || null,
        );
        setCategory(guessed === 'Investment' ? 'Other' : guessed);
      }
      setManualCategoryPicked(false);
    }
  };

  const handleCounterpartyChange = (next: string) => {
    setCounterparty(next);
    if (!manualCategoryPicked && entryKind !== 'INVEST') {
      const guessed = guessCategory(
        next.trim() || null,
        transaction?.rawText ?? null,
        direction,
        [],
        note.trim() || null,
      );
      setCategory(guessed);
      if (guessed === 'Investment' && direction === 'DEBIT') {
        setEntryKind('INVEST');
        if (next.trim() && next.trim().toLowerCase() !== 'invest' && !note.trim()) {
          setNote(next.trim());
        }
        setCounterparty('Invest');
      }
    }
  };

  const handleNoteChange = (next: string) => {
    setNote(next);
    if (!manualCategoryPicked && entryKind !== 'INVEST') {
      const guessed = guessCategory(
        counterparty.trim() || null,
        transaction?.rawText ?? null,
        direction,
        [],
        next.trim() || null,
      );
      setCategory(guessed);
      if (guessed === 'Investment' && direction === 'DEBIT') {
        setEntryKind('INVEST');
        setCounterparty('Invest');
      }
    }
  };

  const save = async () => {
    const parsed = parseAmount(amount);
    if (parsed === null) {
      Alert.alert('Enter an amount', 'Amount must be a number greater than zero.');
      return;
    }

    setSaving(true);
    try {
      const finalCategory = entryKind === 'INVEST' ? 'Investment' : category;
      const rawName = counterparty.trim() ? counterparty.trim() : null;
      const finalName = finalCategory === 'Investment' && direction === 'DEBIT' ? 'Invest' : rawName;
      let finalNote = note.trim() ? note.trim() : null;
      if (
        finalCategory === 'Investment' &&
        rawName &&
        rawName.toLowerCase() !== 'invest' &&
        !finalNote
      ) {
        finalNote = rawName;
      }
      const finalTail =
        paymentMode === 'CASH' ? null : accountTail.trim() || null;

      const canCreateRule =
        rawName &&
        rawName.length >= 2 &&
        !['invest', 'view', 'unknown'].includes(rawName.toLowerCase());

      if (
        canCreateRule &&
        (saveForever || (transaction && finalCategory !== transaction.category))
      ) {
        await upsertCategoryRule(rawName, finalCategory, {
          counterpartyOverride: finalName,
          defaultNote: lockNoteForever ? finalNote : null,
          autoExclude: saveForever && excluded ? true : undefined,
        });
      }

      if (transaction) {
        await patchTransaction(transaction.id, {
          amount: parsed,
          direction,
          paymentMode,
          category: finalCategory,
          counterparty: finalName,
          note: finalNote,
          accountTail: finalTail,
          excluded,
        });
      } else {
        await addManual({
          amount: parsed,
          direction,
          paymentMode,
          category: finalCategory,
          counterparty: finalName,
          note: finalNote,
          accountTail: finalTail,
          occurredAt: Date.now(),
        });
      }

      if (saveForever) {
        await reload();
      }
      onClose();
    } catch (error) {
      Alert.alert('Could not save', String(error));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = () => {
    if (!transaction) {
      return;
    }
    Alert.alert('Delete transaction?', 'This removes it from all totals and history.', [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          removeTransaction(transaction.id)
            .then(onClose)
            .catch(error => Alert.alert('Could not delete', String(error)));
        },
      },
    ]);
  };

  const trimmedCp = counterparty.trim();
  const showForeverToggle =
    entryKind !== 'INVEST' &&
    trimmedCp.length >= 2 &&
    !['invest', 'view', 'unknown'].includes(trimmedCp.toLowerCase());

  return (
    <Sheet
      onClose={onClose}
      title={isNew ? 'Add transaction' : 'Edit transaction'}
      visible={visible}>
      {meta ? <Muted style={styles.meta}>{meta}</Muted> : null}

      <Field
        keyboardType="decimal-pad"
        label="Amount"
        onChangeText={setAmount}
        placeholder="0.00"
        value={amount}
      />

      <Label>Type</Label>
      <View style={styles.chipRow}>
        <Chip
          label="Expense"
          onPress={() => applyEntryKind('EXPENSE')}
          selected={entryKind === 'EXPENSE'}
        />
        <Chip
          label="Invest"
          onPress={() => applyEntryKind('INVEST')}
          selected={entryKind === 'INVEST'}
        />
        <Chip
          label="Income"
          onPress={() => applyEntryKind('INCOME')}
          selected={entryKind === 'INCOME'}
        />
      </View>

      <Label>Paid with</Label>
      <View style={styles.chipRow}>
        <Chip label="Cash" onPress={() => setPaymentMode('CASH')} selected={paymentMode === 'CASH'} />
        <Chip label="UPI" onPress={() => setPaymentMode('UPI')} selected={paymentMode === 'UPI'} />
      </View>

      {paymentMode === 'UPI' ? (
        <View style={styles.accountBlock}>
          <Label>Bank Account (last digits)</Label>
          {knownTails.length > 0 ? (
            <View style={styles.chipRow}>
              {knownTails.map(tail => (
                <Chip
                  key={tail}
                  label={`A/c ••${tail}`}
                  onPress={() => setAccountTail(tail)}
                  selected={accountTail === tail}
                />
              ))}
            </View>
          ) : null}
          <Field
            keyboardType="numeric"
            label="Account tail digits"
            onChangeText={setAccountTail}
            placeholder="e.g. 911"
            value={accountTail}
          />
        </View>
      ) : null}

      {entryKind === 'INVEST' ? (
        <View style={styles.investBanner}>
          <Label>Client Name</Label>
          <Text style={styles.investLockedName}>Invest (standardized for all investments)</Text>
        </View>
      ) : (
        <Field
          autoCapitalize="words"
          label={direction === 'DEBIT' ? 'Client / Paid to' : 'Received from'}
          onChangeText={handleCounterpartyChange}
          placeholder="e.g. Pills N More, Hubble, Starbucks"
          value={counterparty}
        />
      )}

      <Field
        label={entryKind === 'INVEST' ? 'Stock / Fund / SIP Note' : 'Note'}
        multiline={entryKind !== 'INVEST'}
        onChangeText={handleNoteChange}
        placeholder={
          entryKind === 'INVEST' ? 'e.g. Olectra Greentech, JPL, SIP' : 'Optional item detail'
        }
        value={note}
      />

      {entryKind !== 'INVEST' ? (
        <>
          <Label>Category</Label>
          <View style={styles.chipRow}>
            {CATEGORIES.map(item => {
              const cm = categoryMeta(item);
              return (
                <Chip
                  key={item}
                  label={`${cm.icon}  ${cm.shortLabel}`}
                  onPress={() => {
                    setCategory(item);
                    setManualCategoryPicked(true);
                    if (item === 'Investment' && direction === 'DEBIT') {
                      applyEntryKind('INVEST');
                    }
                  }}
                  selected={category === item}
                />
              );
            })}
          </View>
        </>
      ) : null}

      {showForeverToggle ? (
        <>
          <Divider />
          <ToggleRow
            onValueChange={setSaveForever}
            subtitle={`Always classify "${trimmedCp}" into ${category} for all past & future payments.`}
            title={`Set forever rule for "${trimmedCp}"`}
            value={saveForever}
          />
          {saveForever && note.trim().length > 0 ? (
            <ToggleRow
              onValueChange={setLockNoteForever}
              subtitle={`Default note "${note.trim()}" when no note is set.`}
              title="Also save note as default for this client"
              value={lockNoteForever}
            />
          ) : null}
        </>
      ) : null}

      {transaction ? (
        <>
          <Divider />
          <ToggleRow
            onValueChange={setExcluded}
            subtitle="Hide from totals without deleting (e.g. tolls, self-transfers)."
            title="Exclude from totals"
            value={excluded}
          />
        </>
      ) : null}

      <PrimaryButton
        gradient={colors.accentGradient}
        loading={saving}
        onPress={save}
        style={styles.save}
        title={isNew ? 'Add transaction' : 'Save changes'}
      />

      {transaction?.rawText ? (
        <View style={styles.rawBlock}>
          <GhostButton
            onPress={() => setShowRaw(value => !value)}
            title={showRaw ? 'Hide raw message' : 'Show raw message'}
          />
          {showRaw ? (
            <View style={styles.rawBody}>
              <Text style={styles.rawText}>{transaction.rawText}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {transaction ? (
        <PrimaryButton
          onPress={confirmDelete}
          style={styles.delete}
          title="Delete transaction"
          tone="danger"
        />
      ) : null}
    </Sheet>
  );
}

function useStyles(colors: Palette) {
  return React.useMemo(
    () =>
      StyleSheet.create({
        meta: {
          marginBottom: spacing.lg,
        },
        chipRow: {
          flexDirection: 'row',
          flexWrap: 'wrap',
          marginBottom: spacing.md,
        },
        accountBlock: {
          marginBottom: spacing.xs,
        },
        investBanner: {
          backgroundColor: colors.surfaceAlt,
          borderColor: colors.border,
          borderRadius: radius.md,
          borderWidth: 1,
          marginBottom: spacing.lg,
          padding: spacing.md,
        },
        investLockedName: {
          color: colors.accent,
          fontSize: 15,
          fontWeight: '700',
          marginTop: 2,
        },
        save: {
          marginTop: spacing.sm,
        },
        delete: {
          marginTop: spacing.md,
        },
        rawBlock: {
          marginTop: spacing.lg,
        },
        rawBody: {
          backgroundColor: colors.surfaceAlt,
          borderRadius: radius.md,
          marginTop: spacing.sm,
          padding: spacing.md,
        },
        rawText: {
          color: colors.textDim,
          fontSize: 12,
          lineHeight: 18,
        },
      }),
    [colors],
  );
}
