/**
 * Live theme state: light/dark mode, persisted in the database's `settings`
 * table and mirrored to native SharedPreferences so the home screen widget
 * (which has no access to the JS runtime while the app is closed) can render
 * in the same mode.
 */
import React, {createContext, useCallback, useContext, useEffect, useMemo, useState} from 'react';

import {getSetting, setSetting} from '../db/repository';
import {pushThemeMode} from '../native/capture';
import {darkPalette, paletteFor, type Palette, type ThemeMode} from './theme';

export const SETTING_THEME_MODE = 'theme_mode';

interface ThemeContextValue {
  mode: ThemeMode;
  colors: Palette;
  setMode: (next: ThemeMode) => void;
  toggleMode: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'dark',
  colors: darkPalette,
  setMode: () => {},
  toggleMode: () => {},
});

export function ThemeProvider({children}: {children: React.ReactNode}) {
  const [mode, setModeState] = useState<ThemeMode>('dark');

  // Load the saved preference once the database is ready. Reading the setting
  // can race initDatabase() on cold start; a failure just keeps the default.
  useEffect(() => {
    getSetting(SETTING_THEME_MODE)
      .then(saved => {
        if (saved === 'light' || saved === 'dark') {
          setModeState(saved);
          pushThemeMode(saved);
        }
      })
      .catch(() => {});
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    setSetting(SETTING_THEME_MODE, next).catch(() => {});
    // The widget re-renders itself immediately using the mirrored preference,
    // rather than waiting for the app to push a full summary update.
    pushThemeMode(next);
  }, []);

  const toggleMode = useCallback(() => {
    setMode(mode === 'dark' ? 'light' : 'dark');
  }, [mode, setMode]);

  const value = useMemo<ThemeContextValue>(
    () => ({mode, colors: paletteFor(mode), setMode, toggleMode}),
    [mode, setMode, toggleMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

/** Convenience hook for components that only need the colour palette. */
export function useThemeColors(): Palette {
  return useContext(ThemeContext).colors;
}
