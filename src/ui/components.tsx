/**
 * V2 shared presentation primitives and lightweight visual chart components.
 * Built with React Native core primitives only (no SVG/gradient native libs
 * required), reading live theme tokens from ThemeContext.
 */
import React, {useMemo, useState} from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import type {AccountFilter, BankAccountSummary} from '../core/types';
import {categoryColor, radius, spacing, withAlpha, type Palette} from './theme';
import {useTheme, useThemeColors} from './themeContext';

// ---------------------------------------------------------------------------
// Gradient interpolation helpers (pure JS, smooth 18-stop strips)
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) {
    return [128, 128, 128];
  }
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function interpolateStops(colors: string[], steps = 18): string[] {
  if (colors.length === 0) {
    return ['#000000'];
  }
  if (colors.length === 1) {
    return [colors[0]];
  }
  const rgbs = colors.map(hexToRgb);
  const out: string[] = [];
  const segments = rgbs.length - 1;
  for (let i = 0; i < steps; i += 1) {
    const t = steps === 1 ? 0 : i / (steps - 1);
    const scaled = t * segments;
    const idx = Math.min(segments - 1, Math.floor(scaled));
    const localT = scaled - idx;
    const [r1, g1, b1] = rgbs[idx];
    const [r2, g2, b2] = rgbs[idx + 1];
    const r = Math.round(r1 + (r2 - r1) * localT);
    const g = Math.round(g1 + (g2 - g1) * localT);
    const b = Math.round(b1 + (b2 - b1) * localT);
    out.push(`rgb(${r}, ${g}, ${b})`);
  }
  return out;
}

export function GradientSurface({
  colors: gradientColors,
  glowColor,
  style,
  children,
}: {
  colors: string[];
  glowColor?: string;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const colors = useThemeColors();
  const styles = useStyles();
  const stops = useMemo(() => interpolateStops(gradientColors, 18), [gradientColors]);

  return (
    <View style={[styles.gradientCard, {borderColor: colors.border}, style]}>
      <View pointerEvents="none" style={styles.gradientLayer}>
        {stops.map((bg, index) => (
          <View key={index} style={[styles.gradientSlice, {backgroundColor: bg}]} />
        ))}
        {glowColor ? (
          <View
            style={[
              styles.glowOrb,
              {backgroundColor: withAlpha(glowColor, colors.mode === 'dark' ? 0.16 : 0.12)},
            ]}
          />
        ) : null}
      </View>
      {children}
    </View>
  );
}

export function LinearGradientBar({
  colors: gradientColors,
  ratio,
  height = 8,
  trackColor,
}: {
  colors: [string, string];
  ratio: number;
  height?: number;
  trackColor?: string;
}) {
  const themeColors = useThemeColors();
  const styles = useStyles();
  const clamped = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  const stops = useMemo(() => interpolateStops(gradientColors, 14), [gradientColors]);

  return (
    <View
      style={[
        styles.progressTrack,
        {
          height,
          borderRadius: height / 2,
          backgroundColor: trackColor ?? themeColors.surfaceAlt,
        },
      ]}>
      {clamped > 0 ? (
        <View
          style={[
            styles.gradientBarFill,
            {
              width: `${clamped * 100}%`,
              height,
              borderRadius: height / 2,
            },
          ]}>
          {stops.map((bg, index) => (
            <View key={index} style={[styles.gradientSlice, {backgroundColor: bg}]} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles();
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionHeader({title, action}: {title: string; action?: React.ReactNode}) {
  const styles = useStyles();
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action}
    </View>
  );
}

export function Label({children, style}: {children: React.ReactNode; style?: StyleProp<TextStyle>}) {
  const styles = useStyles();
  return <Text style={[styles.label, style]}>{children}</Text>;
}

export function Muted({
  children,
  numberOfLines,
  style,
}: {
  children: React.ReactNode;
  numberOfLines?: number;
  style?: StyleProp<TextStyle>;
}) {
  const styles = useStyles();
  return (
    <Text numberOfLines={numberOfLines} style={[styles.muted, style]}>
      {children}
    </Text>
  );
}

// ---------------------------------------------------------------------------

export function PrimaryButton({
  title,
  onPress,
  disabled,
  loading,
  tone = 'accent',
  gradient,
  style,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  tone?: 'accent' | 'danger' | 'neutral';
  gradient?: [string, string];
  style?: StyleProp<ViewStyle>;
}) {
  const colors = useThemeColors();
  const styles = useStyles();
  const background =
    tone === 'danger' ? colors.danger : tone === 'neutral' ? colors.surfaceAlt : colors.accentDeep;
  const labelColor = tone === 'neutral' ? colors.text : colors.onAccent;
  const activeGradient =
    gradient ??
    (tone === 'accent'
      ? colors.accentGradient
      : tone === 'danger'
        ? colors.dangerGradient
        : undefined);
  const stops = useMemo(
    () => (activeGradient ? interpolateStops(activeGradient, 14) : []),
    [activeGradient],
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{disabled: Boolean(disabled || loading)}}
      disabled={disabled || loading}
      onPress={onPress}
      style={({pressed}) => [
        styles.button,
        {
          backgroundColor: background,
          opacity: disabled ? 0.45 : pressed ? 0.86 : 1,
          overflow: 'hidden',
        },
        style,
      ]}>
      {stops.length > 0 ? (
        <View pointerEvents="none" style={styles.buttonGradientBg}>
          {stops.map((bg, i) => (
            <View key={i} style={[styles.gradientSlice, {backgroundColor: bg}]} />
          ))}
        </View>
      ) : null}
      {loading ? (
        <ActivityIndicator color={labelColor} size="small" />
      ) : (
        <Text style={[styles.buttonText, {color: labelColor}]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function GhostButton({
  title,
  onPress,
  style,
}: {
  title: string;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({pressed}) => [styles.ghostButton, {opacity: pressed ? 0.6 : 1}, style]}>
      <Text style={styles.ghostButtonText}>{title}</Text>
    </Pressable>
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{value: T; label: string}>;
  value: T;
  onChange: (next: T) => void;
}) {
  const styles = useStyles();
  return (
    <View style={styles.segment}>
      {options.map(option => {
        const active = option.value === value;
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{selected: active}}
            key={option.value}
            onPress={() => onChange(option.value)}
            style={[styles.segmentItem, active ? styles.segmentItemActive : null]}>
            <Text style={[styles.segmentText, active ? styles.segmentTextActive : null]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  tint,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  tint?: string;
}) {
  const colors = useThemeColors();
  const styles = useStyles();
  const active = tint ?? colors.accentDeep;
  const labelColor = colors.onAccent;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{selected: Boolean(selected)}}
      onPress={onPress}
      style={[
        styles.chip,
        selected ? {backgroundColor: active, borderColor: active} : null,
      ]}>
      <Text style={[styles.chipText, selected ? {color: labelColor} : null]}>{label}</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  multiline,
  autoCapitalize,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'decimal-pad';
  multiline?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words';
}) {
  const colors = useThemeColors();
  const styles = useStyles();
  return (
    <View style={styles.field}>
      <Label>{label}</Label>
      <TextInput
        autoCapitalize={autoCapitalize ?? 'sentences'}
        keyboardType={keyboardType ?? 'default'}
        multiline={multiline}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        style={[styles.input, multiline ? styles.inputMultiline : null]}
        value={value}
      />
    </View>
  );
}

export function ToggleRow({
  title,
  subtitle,
  value,
  onValueChange,
  disabled,
}: {
  title: string;
  subtitle?: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const colors = useThemeColors();
  const styles = useStyles();
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleText}>
        <Text style={styles.rowTitle}>{title}</Text>
        {subtitle ? <Muted style={styles.rowSubtitle}>{subtitle}</Muted> : null}
      </View>
      <Switch
        disabled={disabled}
        onValueChange={onValueChange}
        thumbColor={value ? colors.accent : colors.textFaint}
        trackColor={{false: colors.surfaceAlt, true: colors.accentSoft}}
        value={value}
      />
    </View>
  );
}

export function TappableRow({
  title,
  subtitle,
  value,
  onPress,
  tone,
}: {
  title: string;
  subtitle?: string;
  value?: string;
  onPress: () => void;
  tone?: 'default' | 'danger';
}) {
  const colors = useThemeColors();
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({pressed}) => [styles.tappableRow, {opacity: pressed ? 0.6 : 1}]}>
      <View style={styles.toggleText}>
        <Text style={[styles.rowTitle, tone === 'danger' ? {color: colors.danger} : null]}>
          {title}
        </Text>
        {subtitle ? <Muted style={styles.rowSubtitle}>{subtitle}</Muted> : null}
      </View>
      {value ? <Text style={styles.rowValue}>{value}</Text> : <Text style={styles.chevron}>›</Text>}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------

export function Banner({
  tone = 'warning',
  title,
  body,
  actionLabel,
  onAction,
}: {
  tone?: 'warning' | 'info' | 'danger';
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const colors = useThemeColors();
  const styles = useStyles();
  const accent =
    tone === 'danger' ? colors.danger : tone === 'info' ? colors.accent : colors.warning;

  return (
    <View style={[styles.banner, {borderLeftColor: accent}]}>
      <Text style={styles.bannerTitle}>{title}</Text>
      <Muted style={styles.bannerBody}>{body}</Muted>
      {actionLabel && onAction ? (
        <GhostButton onPress={onAction} style={styles.bannerAction} title={actionLabel} />
      ) : null}
    </View>
  );
}

export function ProgressBar({
  ratio,
  tint,
  gradient,
  height = 8,
}: {
  ratio: number;
  tint?: string;
  gradient?: [string, string];
  height?: number;
}) {
  const colors = useThemeColors();
  const styles = useStyles();
  const clamped = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));

  if (gradient) {
    return <LinearGradientBar colors={gradient} height={height} ratio={clamped} />;
  }

  return (
    <View style={[styles.progressTrack, {height, borderRadius: height / 2}]}>
      <View
        style={{
          width: `${clamped * 100}%`,
          height,
          borderRadius: height / 2,
          backgroundColor: tint ?? colors.accent,
        }}
      />
    </View>
  );
}

export function StatTile({
  label,
  value,
  subtitle,
  tone,
  bg,
}: {
  label: string;
  value: string;
  subtitle?: string;
  tone?: string;
  bg?: string;
}) {
  const styles = useStyles();
  return (
    <View style={[styles.statTile, bg ? {backgroundColor: bg} : null]}>
      <Text numberOfLines={1} style={[styles.statValue, tone ? {color: tone} : null]}>
        {value}
      </Text>
      <Muted numberOfLines={1} style={styles.statLabel}>
        {label}
      </Muted>
      {subtitle ? (
        <Muted numberOfLines={1} style={styles.statSub}>
          {subtitle}
        </Muted>
      ) : null}
    </View>
  );
}

export function AccountPills({
  accounts,
  value,
  onChange,
}: {
  accounts: BankAccountSummary[];
  value: AccountFilter;
  onChange: (next: AccountFilter) => void;
}) {
  const colors = useThemeColors();
  const styles = useStyles();

  if (accounts.length === 0) {
    return null;
  }

  const items: Array<{key: string; label: string}> = [
    {key: 'ALL', label: 'All Accounts'},
    ...accounts.map(a => ({
      key: a.accountTail,
      label: a.label,
    })),
  ];

  return (
    <ScrollView
      contentContainerStyle={styles.accountScroll}
      horizontal
      showsHorizontalScrollIndicator={false}>
      {items.map(item => {
        const active = value === item.key;
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{selected: active}}
            key={item.key}
            onPress={() => onChange(item.key)}
            style={[
              styles.accountPill,
              active
                ? {
                    backgroundColor: colors.accentSoft,
                    borderColor: colors.accent,
                  }
                : null,
            ]}>
            <Text
              style={[
                styles.accountPillText,
                active ? {color: colors.accent, fontWeight: '700'} : null,
              ]}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// V2 Visual Charts
// ---------------------------------------------------------------------------

export interface AllocationSegment {
  key: string;
  label: string;
  value: number;
  color: string;
  icon?: string;
}

export function StackedAllocationBar({
  segments,
  formatValue,
  onSelect,
  maxLegend = 6,
}: {
  segments: AllocationSegment[];
  formatValue: (value: number) => string;
  onSelect?: (key: string) => void;
  maxLegend?: number;
}) {
  const colors = useThemeColors();
  const styles = useStyles();
  const positive = segments.filter(s => s.value > 0);
  const total = positive.reduce((sum, s) => sum + s.value, 0);

  if (positive.length === 0 || total <= 0) {
    return <Muted>No data recorded yet.</Muted>;
  }

  const visibleLegend = positive.slice(0, maxLegend);

  return (
    <View>
      <View style={[styles.stackedTrack, {backgroundColor: colors.surfaceAlt}]}>
        {positive.map((seg, idx) => (
          <View
            key={seg.key}
            style={{
              flex: Math.max(0.03, seg.value / total),
              height: '100%',
              backgroundColor: seg.color,
              marginRight: idx < positive.length - 1 ? 2 : 0,
            }}
          />
        ))}
      </View>

      <View style={styles.legendGrid}>
        {visibleLegend.map(seg => {
          const pct = Math.round((seg.value / total) * 100);
          return (
            <Pressable
              disabled={!onSelect}
              key={seg.key}
              onPress={() => onSelect?.(seg.key)}
              style={({pressed}) => [
                styles.legendPill,
                {backgroundColor: colors.surfaceAlt, borderColor: colors.border},
                pressed && onSelect ? {opacity: 0.72} : null,
              ]}>
              <View style={styles.legendTop}>
                <View style={[styles.legendDot, {backgroundColor: seg.color}]} />
                <Text numberOfLines={1} style={styles.legendLabel}>
                  {seg.icon ? `${seg.icon} ` : ''}
                  {seg.label}
                </Text>
                <Text style={styles.legendPct}>{pct}%</Text>
              </View>
              <Text style={styles.legendValue}>{formatValue(seg.value)}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function DualTrendChart({
  items,
  formatValue,
  onSelect,
  selectedKey,
}: {
  items: Array<{key: string; label: string; spend: number; invested: number}>;
  formatValue: (value: number) => string;
  onSelect?: (key: string) => void;
  selectedKey?: string;
}) {
  const colors = useThemeColors();
  const styles = useStyles();
  const max = items.reduce(
    (peak, item) => Math.max(peak, item.spend, item.invested),
    0,
  );

  return (
    <View>
      <View style={styles.dualLegendRow}>
        <View style={styles.dualLegendItem}>
          <View style={[styles.legendDot, {backgroundColor: colors.accent}]} />
          <Muted style={styles.dualLegendText}>Living Spend</Muted>
        </View>
        <View style={styles.dualLegendItem}>
          <View style={[styles.legendDot, {backgroundColor: colors.invest}]} />
          <Muted style={styles.dualLegendText}>Invested</Muted>
        </View>
      </View>

      <View style={styles.trendRow}>
        {items.map(item => {
          const spendRatio = max > 0 ? item.spend / max : 0;
          const investRatio = max > 0 ? item.invested / max : 0;
          const selected = item.key === selectedKey;
          return (
            <Pressable
              accessibilityLabel={`${item.label}: Spend ${formatValue(item.spend)}, Invested ${formatValue(item.invested)}`}
              accessibilityRole="button"
              key={item.key}
              onPress={() => onSelect?.(item.key)}
              style={[
                styles.trendColumn,
                selected ? {backgroundColor: withAlpha(colors.accent, 0.1), borderRadius: radius.sm} : null,
              ]}>
              <View style={styles.dualBarArea}>
                <View
                  style={[
                    styles.dualBar,
                    {
                      height: `${item.spend > 0 ? Math.max(4, spendRatio * 100) : 2}%`,
                      backgroundColor: selected ? colors.accent : withAlpha(colors.accent, 0.72),
                    },
                  ]}
                />
                <View
                  style={[
                    styles.dualBar,
                    {
                      height: `${item.invested > 0 ? Math.max(4, investRatio * 100) : 2}%`,
                      backgroundColor: selected ? colors.invest : withAlpha(colors.invest, 0.78),
                    },
                  ]}
                />
              </View>
              <Text
                numberOfLines={1}
                style={[styles.trendLabel, selected ? {color: colors.text, fontWeight: '700'} : null]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.trendFooter}>
        <Muted>Peak {formatValue(max)}</Muted>
      </View>
    </View>
  );
}

export function WeekdayStrip({
  items,
  formatValue,
}: {
  items: Array<{key: string; label: string; value: number}>;
  formatValue: (value: number) => string;
}) {
  const colors = useThemeColors();
  const styles = useStyles();
  const max = items.reduce((peak, item) => Math.max(peak, item.value), 0);
  const peakDay = items.reduce(
    (best, item) => (item.value > best.value ? item : best),
    items[0] ?? {key: '', label: '', value: 0},
  );
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const activeItem = items.find(i => i.key === focusedKey) ?? peakDay;

  return (
    <View>
      <View style={styles.weekdayRow}>
        {items.map(item => {
          const ratio = max > 0 ? item.value / max : 0;
          const isPeak = item.key === activeItem?.key;
          const fillOpacity = item.value <= 0 ? 0.08 : 0.22 + ratio * 0.78;
          return (
            <Pressable
              key={item.key}
              onPress={() => setFocusedKey(item.key)}
              style={styles.weekdayCol}>
              <View style={styles.weekdayBarTrack}>
                <View
                  style={[
                    styles.weekdayBarFill,
                    {
                      height: `${item.value > 0 ? Math.max(16, ratio * 100) : 10}%`,
                      backgroundColor: withAlpha(colors.accent, fillOpacity),
                      borderColor: isPeak ? colors.accent : 'transparent',
                      borderWidth: isPeak ? 1 : 0,
                    },
                  ]}
                />
              </View>
              <Text
                style={[
                  styles.weekdayLabel,
                  isPeak ? {color: colors.text, fontWeight: '700'} : null,
                ]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {max > 0 && activeItem ? (
        <Muted style={styles.weekdayCaption}>
          {activeItem.key === peakDay.key ? 'Peak day' : activeItem.label}: {activeItem.label} ·{' '}
          {formatValue(activeItem.value)}
        </Muted>
      ) : null}
    </View>
  );
}

/** Horizontal bars, used for category, holdings and merchant breakdowns. */
export function BarList({
  items,
  formatValue,
}: {
  items: Array<{key: string; label: string; value: number; color?: string; gradient?: [string, string]}>;
  formatValue: (value: number) => string;
}) {
  const {mode} = useTheme();
  const styles = useStyles();
  const max = items.reduce((peak, item) => Math.max(peak, item.value), 0);
  if (items.length === 0 || max <= 0) {
    return <Muted>No spending recorded yet.</Muted>;
  }

  return (
    <View>
      {items.map(item => (
        <View key={item.key} style={styles.barRow}>
          <View style={styles.barHeader}>
            <Text numberOfLines={1} style={styles.barLabel}>
              {item.label}
            </Text>
            <Text style={styles.barValue}>{formatValue(item.value)}</Text>
          </View>
          <ProgressBar
            gradient={item.gradient}
            height={6}
            ratio={item.value / max}
            tint={item.color ?? categoryColor(item.label, mode)}
          />
        </View>
      ))}
    </View>
  );
}

/** Vertical bars for a single-metric month-over-month trend (e.g. Investments). */
export function TrendChart({
  items,
  formatValue,
  onSelect,
  selectedKey,
  tint,
}: {
  items: Array<{key: string; label: string; value: number}>;
  formatValue: (value: number) => string;
  onSelect?: (key: string) => void;
  selectedKey?: string;
  tint?: string;
}) {
  const colors = useThemeColors();
  const styles = useStyles();
  const max = items.reduce((peak, item) => Math.max(peak, item.value), 0);
  const barTint = tint ?? colors.accent;

  return (
    <View>
      <View style={styles.trendRow}>
        {items.map(item => {
          const ratio = max > 0 ? item.value / max : 0;
          const selected = item.key === selectedKey;
          return (
            <Pressable
              accessibilityLabel={`${item.label}: ${formatValue(item.value)}`}
              accessibilityRole="button"
              key={item.key}
              onPress={() => onSelect?.(item.key)}
              style={styles.trendColumn}>
              <View style={styles.trendBarArea}>
                <View
                  style={[
                    styles.trendBar,
                    {
                      height: `${Math.max(3, ratio * 100)}%`,
                      backgroundColor: selected ? barTint : withAlpha(barTint, 0.55),
                      borderColor: selected ? barTint : 'transparent',
                    },
                  ]}
                />
              </View>
              <Text
                numberOfLines={1}
                style={[styles.trendLabel, selected ? {color: colors.text} : null]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.trendFooter}>
        <Muted>Peak {formatValue(max)}</Muted>
      </View>
    </View>
  );
}

export function EmptyState({title, body}: {title: string; body: string}) {
  const styles = useStyles();
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Muted style={styles.emptyBody}>{body}</Muted>
    </View>
  );
}

export function Divider() {
  const styles = useStyles();
  return <View style={styles.divider} />;
}

// ---------------------------------------------------------------------------

export function Sheet({
  visible,
  title,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const styles = useStyles();
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.sheetBackdrop}>
        <Pressable accessibilityLabel="Close" onPress={onClose} style={styles.sheetDismissArea} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{title}</Text>
            <Pressable accessibilityRole="button" onPress={onClose}>
              <Text style={styles.sheetClose}>Close</Text>
            </Pressable>
          </View>
          <ScrollView
            contentContainerStyle={styles.sheetContent}
            keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

function buildStyles(colors: Palette) {
  return StyleSheet.create({
    gradientCard: {
      borderRadius: radius.xl,
      borderWidth: 1,
      overflow: 'hidden',
      padding: spacing.lg,
      position: 'relative',
    },
    gradientLayer: {
      bottom: 0,
      flexDirection: 'row',
      left: 0,
      position: 'absolute',
      right: 0,
      top: 0,
    },
    gradientSlice: {
      flex: 1,
    },
    gradientBarFill: {
      flexDirection: 'row',
      overflow: 'hidden',
    },
    glowOrb: {
      borderRadius: 90,
      height: 160,
      position: 'absolute',
      right: -36,
      top: -46,
      width: 160,
    },
    card: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: radius.lg,
      borderWidth: 1,
      padding: spacing.lg,
    },
    sectionHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: spacing.md,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '700',
      letterSpacing: -0.2,
    },
    label: {
      color: colors.textDim,
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.6,
      marginBottom: spacing.xs,
      textTransform: 'uppercase',
    },
    muted: {
      color: colors.textDim,
      fontSize: 13,
      lineHeight: 19,
    },
    button: {
      alignItems: 'center',
      borderRadius: radius.md,
      justifyContent: 'center',
      minHeight: 48,
      paddingHorizontal: spacing.lg,
      position: 'relative',
    },
    buttonGradientBg: {
      bottom: 0,
      flexDirection: 'row',
      left: 0,
      position: 'absolute',
      right: 0,
      top: 0,
    },
    buttonText: {
      fontSize: 15,
      fontWeight: '700',
    },
    ghostButton: {
      alignSelf: 'flex-start',
      borderColor: colors.border,
      borderRadius: radius.md,
      borderWidth: 1,
      justifyContent: 'center',
      minHeight: 38,
      paddingHorizontal: spacing.md,
    },
    ghostButtonText: {
      color: colors.accent,
      fontSize: 13,
      fontWeight: '600',
    },
    chip: {
      backgroundColor: colors.surfaceAlt,
      borderColor: colors.border,
      borderRadius: radius.pill,
      borderWidth: 1,
      marginBottom: spacing.sm,
      marginRight: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: 7,
    },
    segment: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: radius.md,
      borderWidth: 1,
      flexDirection: 'row',
      padding: 3,
    },
    segmentItem: {
      alignItems: 'center',
      borderRadius: radius.sm - 2,
      flex: 1,
      paddingVertical: 7,
    },
    segmentItemActive: {
      backgroundColor: colors.accentDeep,
    },
    segmentText: {
      color: colors.textDim,
      fontSize: 12,
      fontWeight: '600',
    },
    segmentTextActive: {
      color: colors.onAccent,
      fontWeight: '700',
    },
    chipText: {
      color: colors.textDim,
      fontSize: 12,
      fontWeight: '600',
    },
    field: {
      marginBottom: spacing.lg,
    },
    input: {
      backgroundColor: colors.surfaceAlt,
      borderColor: colors.border,
      borderRadius: radius.md,
      borderWidth: 1,
      color: colors.text,
      fontSize: 16,
      minHeight: 48,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
    },
    inputMultiline: {
      minHeight: 84,
      textAlignVertical: 'top',
    },
    toggleRow: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: spacing.md,
    },
    tappableRow: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: spacing.md,
    },
    toggleText: {
      flex: 1,
      paddingRight: spacing.md,
    },
    rowTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '600',
    },
    rowSubtitle: {
      fontSize: 12,
      marginTop: 2,
    },
    rowValue: {
      color: colors.accent,
      fontSize: 14,
      fontWeight: '600',
    },
    chevron: {
      color: colors.textFaint,
      fontSize: 22,
    },
    banner: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderLeftWidth: 3,
      borderRadius: radius.md,
      borderWidth: 1,
      marginBottom: spacing.md,
      padding: spacing.lg,
    },
    bannerTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '700',
      marginBottom: spacing.xs,
    },
    bannerBody: {
      fontSize: 13,
    },
    bannerAction: {
      marginTop: spacing.md,
    },
    progressTrack: {
      backgroundColor: colors.surfaceAlt,
      overflow: 'hidden',
      width: '100%',
    },
    statTile: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.md,
      flex: 1,
      padding: spacing.md,
    },
    statValue: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '800',
    },
    statLabel: {
      fontSize: 11,
      marginTop: 2,
    },
    statSub: {
      fontSize: 10,
      marginTop: 1,
    },
    accountScroll: {
      gap: spacing.xs,
      paddingVertical: spacing.xs,
    },
    accountPill: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderRadius: radius.pill,
      borderWidth: 1,
      marginRight: spacing.xs,
      paddingHorizontal: 12,
      paddingVertical: 5,
    },
    accountPillText: {
      color: colors.textDim,
      fontSize: 11,
      fontWeight: '600',
    },
    stackedTrack: {
      borderRadius: radius.pill,
      flexDirection: 'row',
      height: 11,
      overflow: 'hidden',
      width: '100%',
    },
    legendGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      marginTop: spacing.md,
    },
    legendPill: {
      borderRadius: radius.md,
      borderWidth: 1,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      width: '48.5%',
    },
    legendTop: {
      alignItems: 'center',
      flexDirection: 'row',
    },
    legendDot: {
      borderRadius: radius.pill,
      height: 8,
      marginRight: 6,
      width: 8,
    },
    legendLabel: {
      color: colors.textDim,
      flex: 1,
      fontSize: 12,
      fontWeight: '600',
    },
    legendPct: {
      color: colors.textFaint,
      fontSize: 11,
      fontWeight: '600',
      marginLeft: 4,
    },
    legendValue: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '700',
      marginTop: 4,
    },
    dualLegendRow: {
      flexDirection: 'row',
      gap: spacing.lg,
      marginBottom: spacing.sm,
    },
    dualLegendItem: {
      alignItems: 'center',
      flexDirection: 'row',
    },
    dualLegendText: {
      fontSize: 11,
    },
    dualBarArea: {
      alignItems: 'flex-end',
      flex: 1,
      flexDirection: 'row',
      gap: 3,
      justifyContent: 'center',
      width: '80%',
    },
    dualBar: {
      borderRadius: 4,
      flex: 1,
    },
    weekdayRow: {
      flexDirection: 'row',
      gap: spacing.xs,
    },
    weekdayCol: {
      alignItems: 'center',
      flex: 1,
    },
    weekdayBarTrack: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.sm,
      height: 50,
      justifyContent: 'flex-end',
      overflow: 'hidden',
      padding: 2,
      width: '100%',
    },
    weekdayBarFill: {
      borderRadius: 6,
      width: '100%',
    },
    weekdayLabel: {
      color: colors.textFaint,
      fontSize: 11,
      marginTop: 6,
    },
    weekdayCaption: {
      fontSize: 12,
      marginTop: spacing.sm,
      textAlign: 'center',
    },
    barRow: {
      marginBottom: spacing.md,
    },
    barHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: spacing.xs,
    },
    barLabel: {
      color: colors.text,
      flex: 1,
      fontSize: 14,
      paddingRight: spacing.sm,
    },
    barValue: {
      color: colors.textDim,
      fontSize: 13,
      fontWeight: '600',
    },
    trendRow: {
      flexDirection: 'row',
      height: 128,
    },
    trendColumn: {
      alignItems: 'center',
      flex: 1,
      paddingVertical: 4,
    },
    trendBarArea: {
      flex: 1,
      justifyContent: 'flex-end',
      width: '62%',
    },
    trendBar: {
      borderRadius: 5,
      borderWidth: 1,
      width: '100%',
    },
    trendLabel: {
      color: colors.textFaint,
      fontSize: 10,
      marginTop: spacing.xs,
    },
    trendFooter: {
      alignItems: 'flex-end',
      marginTop: spacing.xs,
    },
    empty: {
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.xl,
    },
    emptyTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '700',
      marginBottom: spacing.sm,
    },
    emptyBody: {
      textAlign: 'center',
    },
    divider: {
      backgroundColor: colors.border,
      height: StyleSheet.hairlineWidth,
      marginVertical: spacing.sm,
    },
    sheetBackdrop: {
      backgroundColor: colors.overlay,
      flex: 1,
      justifyContent: 'flex-end',
    },
    sheetDismissArea: {
      flex: 1,
    },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      maxHeight: '90%',
      paddingBottom: spacing.xl,
    },
    sheetHandle: {
      alignSelf: 'center',
      backgroundColor: colors.border,
      borderRadius: radius.pill,
      height: 4,
      marginTop: spacing.md,
      width: 44,
    },
    sheetHeader: {
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
    },
    sheetTitle: {
      color: colors.text,
      fontSize: 17,
      fontWeight: '700',
    },
    sheetClose: {
      color: colors.accent,
      fontSize: 14,
      fontWeight: '600',
    },
    sheetContent: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.xl,
    },
  });
}

const styleCache = new Map<Palette['mode'], ReturnType<typeof buildStyles>>();

function useStyles() {
  const colors = useThemeColors();
  return React.useMemo(() => {
    const cached = styleCache.get(colors.mode);
    if (cached) {
      return cached;
    }
    const built = buildStyles(colors);
    styleCache.set(colors.mode, built);
    return built;
  }, [colors]);
}
