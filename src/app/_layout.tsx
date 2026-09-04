import { Outfit_400Regular, Outfit_600SemiBold } from '@expo-google-fonts/outfit';
import { useFonts } from 'expo-font';
import { Stack, useRootNavigationState, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import 'react-native-get-random-values'; // REQUIRED POLYFILL FOR SOCKET.IO ON ANDROID
import { InvoiceApprover } from '../components/InvoiceApprover';
import { AuthProvider, useAuth } from '../context/AuthContext';

try {
  SplashScreen.preventAutoHideAsync();
} catch (e) {
  // Ignorer si déjà masqué nativement
}

function RootLayoutNav() {
  const { token, isLoading } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  const rootNavigationState = useRootNavigationState();

  const [fontsLoaded, fontError] = useFonts({
    'Satoshi-Regular': Outfit_400Regular,
    'Satoshi-SemiBold': Outfit_600SemiBold,
  });

  useEffect(() => {
    // Doit attendre CHACUNE de ces trois conditions séparément (OR des "pas encore prêt"),
    // pas la combinaison précédente ((isLoading || !key) && !fontsLoaded && !fontError) : dès
    // que les polices finissaient de charger (fontsLoaded=true) alors que la session était
    // encore en cours de restauration (isLoading=true), le membre droit du && devenait faux et
    // la garde ne bloquait plus — le routage se décidait sur token===null (valeur initiale) et
    // redirigeait vers /auth/login même pour un utilisateur déjà connecté, avant que
    // restoreSession() (AuthContext) n'ait fini de relire le token stocké.
    if (isLoading || !rootNavigationState?.key || (!fontsLoaded && !fontError)) return;

    const inAuthGroup = segments[0] === 'auth';

    if (!token && !inAuthGroup) {
      router.replace('/auth/login');
    } else if (token && inAuthGroup) {
      router.replace('/');
    }

    // Libérer l'écran de chargement natif une fois que le routage est décidé
    SplashScreen.hideAsync();
  }, [token, isLoading, segments, rootNavigationState?.key]);

  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }}>
        {/* Le groupe (tabs) contient index, history, profile */}
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="transfer" />
        <Stack.Screen name="transfer-confirm" />
        <Stack.Screen name="auth/login" />
        <Stack.Screen name="auth/register" />
      </Stack>
      <InvoiceApprover />
    </>
  );
}

import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SecurityWrapper } from '../components/SecurityWrapper';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <SecurityWrapper>
          <RootLayoutNav />
        </SecurityWrapper>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
