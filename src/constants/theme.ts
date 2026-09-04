/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */


import { useColorScheme } from 'react-native';

// Identité visuelle : bleu franc — reprend le côté bleu (pas la partie verte) du dégradé du
// logo (assets/images/splash-icon.png), qui reste inchangé. Distinct du cyan plat d'origine
// (#1DC5E9), mais cohérent avec la marque déjà établie. Or chaud en accent (valeur, énergie)
// pour les actions clés.
export const Colors = {
  light: {
    primary: '#2563FF',      // Brand Blue
    primaryDark: '#103AB5',
    accent: '#FFB020',       // Brand Orange
    background: '#f7f9fd',
    surface: '#ffffff',
    textPrimary: '#0A0F1C',  // Brand Dark
    textSecondary: '#5f6b7a',
    textHeader: '#ffffff',
    border: '#e2e8f5',
    error: '#DC2626',
    success: '#00C27A',      // Brand Green
    warning: '#FFB020',
    purple: '#7E3AF2',       // Brand Purple
    remaining: '#F0F3FA',
    text: '#0A0F1C',
    backgroundElement: '#f0f3fa',
    backgroundSelected: '#dbeafe'
  },
  dark: {
    primary: '#2563FF',      // Brand Blue
    primaryDark: '#4A7FF0',
    accent: '#FFB020',
    background: '#0A0F1C',   // Brand Dark as background
    surface: '#151822',
    textPrimary: '#ffffff',
    textSecondary: '#9ca3b5',
    textHeader: '#ffffff',
    border: '#242a3a',
    error: '#f87171',
    success: '#00C27A',
    warning: '#FFB020',
    purple: '#7E3AF2',
    remaining: '#242a3a',
    text: '#ffffff',
    backgroundElement: '#1c2130',
    backgroundSelected: '#1e3a5f'
  },
};

export const useAppTheme = () => {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return Colors[scheme];
};
