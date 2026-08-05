/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */


import { Platform, useColorScheme } from 'react-native';

export const Colors = {
  light: {
    primary: '#1DC5E9',
    background: '#f8f9fe',
    surface: '#ffffff',
    textPrimary: '#1a1d2e',
    textSecondary: '#6b7280',
    textHeader: '#ffffff',
    border: '#e5e7eb',
    error: '#E11D48',
    success: '#059669',
    remaining: '#F3F4F6',
    text: '#1a1d2e',
    backgroundElement: '#f3f4f6',
    backgroundSelected: '#e5e7eb'
  },
  dark: {
    primary: '#1DC5E9',
    background: '#0a0a0c',
    surface: '#1c1c1e',
    textPrimary: '#ffffff',
    textSecondary: '#a1a1aa',
    textHeader: '#ffffff',
    border: '#27272a',
    error: '#f87171',
    success: '#34d399',
    remaining: '#27272a',
    text: '#ffffff',
    backgroundElement: '#27272a',
    backgroundSelected: '#3f3f46'
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
