import { Stack, useRootNavigationState, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { AuthProvider, useAuth } from '../context/AuthContext';

SplashScreen.preventAutoHideAsync();

function RootLayoutNav() {
  const { token, isLoading } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  const rootNavigationState = useRootNavigationState();

  useEffect(() => {
    if (isLoading || !rootNavigationState?.key) return;

    const inAuthGroup = segments[0] === 'auth';

    if (!token && !inAuthGroup) {
      router.replace('/auth/login');
    } else if (token && inAuthGroup) {
      router.replace('/');
    }
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
    </>
  );
}

import { SecurityWrapper } from '../components/SecurityWrapper';

export default function RootLayout() {
  return (
    <AuthProvider>
      <SecurityWrapper>
        <RootLayoutNav />
      </SecurityWrapper>
    </AuthProvider>
  );
}
