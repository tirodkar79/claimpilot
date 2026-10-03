import { createPersistedStore } from '../lib/persisted-store';

export const THEME_MODES = ['light', 'dark'] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

const THEME_STORAGE_KEY = 'claimpilot:theme';

/**
 * Narrows a stored string to a theme mode.
 * @param value Stored value.
 */
function isThemeMode(value: string): value is ThemeMode {
    return (THEME_MODES as readonly string[]).includes(value);
}

/** First visit follows the OS preference; after that the user's choice wins. */
function systemTheme(): ThemeMode {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Applies the theme to `<html data-theme>`, which the design tokens key off.
 * @param mode Theme to apply.
 */
function applyTheme(mode: ThemeMode): void {
    document.documentElement.dataset.theme = mode;
}

export const themeStore = createPersistedStore(THEME_STORAGE_KEY, isThemeMode, systemTheme, applyTheme);
