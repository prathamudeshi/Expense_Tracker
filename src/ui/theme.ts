/**
 * Monochromatic, dark-mode-first theme system.
 *
 * Uses a single Steel-Cobalt accent hue (#5B8DEF) and its tonal shades across
 * all cards, bars, category indicators, and subtle surface gradients — avoiding
 * multi-color rainbow clutter for a clean, executive dark UI.
 */
export type ThemeMode = 'dark' | 'light';

export interface Palette {
  mode: ThemeMode;
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textDim: string;
  textFaint: string;
  accent: string;
  accentDeep: string;
  accentSoft: string;
  invest: string;
  investSoft: string;
  danger: string;
  success: string;
  warning: string;
  overlay: string;
  /** Text colour to use on top of `accent`/`accentDeep` fills. */
  onAccent: string;
  heroGradient: [string, string, string];
  accentGradient: [string, string];
  investGradient: [string, string];
  dangerGradient: [string, string];
}

export const darkPalette: Palette = {
  mode: 'dark',
  bg: '#080A0F',
  surface: '#10141D',
  surfaceAlt: '#161C28',
  border: '#1F2737',
  text: '#F1F5F9',
  textDim: '#8B95A7',
  textFaint: '#556074',
  accent: '#5B8DEF',
  accentDeep: '#3B6FD4',
  accentSoft: '#16223B',
  invest: '#7AA2F7',
  investSoft: '#152036',
  danger: '#E06C75',
  success: '#5B8DEF',
  warning: '#94A3B8',
  overlay: 'rgba(5, 7, 11, 0.82)',
  onAccent: '#FFFFFF',
  heroGradient: ['#141C2E', '#101522', '#0B0E17'],
  accentGradient: ['#5B8DEF', '#2E56A6'],
  investGradient: ['#7AA2F7', '#3B6FD4'],
  dangerGradient: ['#E06C75', '#B04A52'],
};

export const lightPalette: Palette = {
  mode: 'light',
  bg: '#F4F6FA',
  surface: '#FFFFFF',
  surfaceAlt: '#EDF1F7',
  border: '#DCE2EC',
  text: '#0F172A',
  textDim: '#475569',
  textFaint: '#8B95A7',
  accent: '#3B6FD4',
  accentDeep: '#2E56A6',
  accentSoft: '#E8EFFC',
  invest: '#2E56A6',
  investSoft: '#E8EFFC',
  danger: '#C94A54',
  success: '#3B6FD4',
  warning: '#64748B',
  overlay: 'rgba(15, 23, 42, 0.45)',
  onAccent: '#FFFFFF',
  heroGradient: ['#E8EFFC', '#F2F5FC', '#FFFFFF'],
  accentGradient: ['#3B6FD4', '#1E3D7A'],
  investGradient: ['#4C7CE0', '#2E56A6'],
  dangerGradient: ['#C94A54', '#9E353E'],
};

export function paletteFor(mode: ThemeMode): Palette {
  return mode === 'light' ? lightPalette : darkPalette;
}

export const colors = darkPalette;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
};

export const radius = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 22,
  pill: 999,
};

/**
 * Tonal shades of the single Steel-Cobalt hue [dark, light].
 * Gives visual hierarchy to stacked bars and lists without multi-color noise.
 */
const CATEGORY_COLORS: Record<string, [string, string]> = {
  'Food & Drink': ['#7AA2F7', '#2E56A6'],
  Groceries: ['#6693F2', '#3562B8'],
  Travel: ['#5584EC', '#3D6EC9'],
  Shopping: ['#4675E0', '#4879D4'],
  'Bills & Utilities': ['#3966CE', '#5484DC'],
  Entertainment: ['#2F57B8', '#6290E3'],
  Health: ['#27499E', '#719CE9'],
  'Personal Care': ['#5078CE', '#4470C4'],
  Investment: ['#93B4FA', '#1E3D7A'],
  Rent: ['#3E63B3', '#5A82D0'],
  Education: ['#4D73C2', '#4E78C8'],
  Transfer: ['#526079', '#64748B'],
  Income: ['#7AA2F7', '#2E56A6'],
  Other: ['#3D485C', '#94A3B8'],
};

export function categoryColor(category: string, mode: ThemeMode = 'dark'): string {
  const entry = CATEGORY_COLORS[category];
  if (!entry) {
    return mode === 'light' ? lightPalette.accent : darkPalette.accent;
  }
  return mode === 'light' ? entry[1] : entry[0];
}

export function withAlpha(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) {
    return hex;
  }
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function modeColor(mode: ThemeMode = 'dark'): {UPI: string; CASH: string} {
  const palette = paletteFor(mode);
  return {
    UPI: palette.accent,
    CASH: palette.textDim,
  };
}
