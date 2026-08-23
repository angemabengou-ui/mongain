/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */


import { Platform, useColorScheme } from 'react-native';

// Identité visuelle : bleu franc — reprend le côté bleu (pas la partie verte) du dégradé du
// logo (assets/images/splash-icon.png), qui reste inchangé. Distinct du cyan plat d'origine
// (#1DC5E9), mais cohérent avec la marque déjà établie. Or chaud en accent (valeur, énergie)
// pour les actions clés.
export const Colors = {
  light: {
    primary: '#2563EB',
    primaryDark: '#1D4ED8',
    accent: '#F59E0B',
    background: '#f7f9fd',
    surface: '#ffffff',
    textPrimary: '#101827',
    textSecondary: '#5f6b7a',
    textHeader: '#ffffff',
    border: '#e2e8f5',
    error: '#DC2626',
    success: '#059669',
    warning: '#D97706',
    remaining: '#F0F3FA',
    text: '#101827',
    backgroundElement: '#f0f3fa',
    backgroundSelected: '#dbeafe'
  },
  dark: {
    primary: '#60A5FA',
    primaryDark: '#2563EB',
    accent: '#FBBF24',
    background: '#0a0a0f',
    surface: '#151822',
    textPrimary: '#ffffff',
    textSecondary: '#9ca3b5',
    textHeader: '#ffffff',
    border: '#242a3a',
    error: '#f87171',
    success: '#34d399',
    warning: '#fbbf24',
    remaining: '#242a3a',
    text: '#ffffff',
    backgroundElement: '#1c2130',
    backgroundSelected: '#1e3a5f'
  },
} as const;

export const useAppTheme = () => {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return Colors[scheme];
};

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
