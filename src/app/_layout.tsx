import { Outfit_400Regular, Outfit_600SemiBold } from '@expo-google-fonts/outfit';
import { useFonts } from 'expo-font';
import { Stack, useRootNavigationState, useRouter, useSegments, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { InvoiceApprover } from '../components/InvoiceApprover';
import { AuthProvider, useAuth } from '../context/AuthContext';

// Sans ce garde-fou, une erreur au tout premier rendu (ex: un hook de routage ou un module
// natif qui se comporte différemment entre le dev client et un build APK autonome) laisse le
// splash natif affiché indéfiniment : rien ne l'a jamais masqué, et aucune trace de l'erreur
// n'est visible pour l'utilisateur. En l'exportant depuis _layout.tsx, Expo Router l'utilise
// comme error boundary racine de toute l'application.
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => { });
  }, []);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#0a0a0f' }}>
      <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 12, textAlign: 'center' }}>
        Mongain n'a pas pu démarrer
      </Text>
      <Text style={{ color: '#9ca3af', fontSize: 14, marginBottom: 24, textAlign: 'center' }}>
        {error.message}
      </Text>
      <TouchableOpacity
        onPress={() => retry()}
        style={{ backgroundColor: '#2563EB', paddingVertical: 14, paddingHorizontal: 32, borderRadius: 16 }}
      >
        <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>Réessayer</Text>
      </TouchableOpacity>
    </View>
  );
}

try {
  SplashScreen.preventAutoHideAsync();
} catch (e) {
  // Ignorer si déjà masqué nativement
}

// Filet de sécurité : si l'une des trois conditions ci-dessous (session restaurée, router
// monté, polices chargées) ne se résout jamais — build APK où un module natif se comporte
// différemment de l'environnement de dev, hook de routage qui ne retourne jamais de clé,
// police qui ne déclenche ni succès ni erreur — l'app restait bloquée indéfiniment sur
// l'image de démarrage native, sans aucun moyen pour l'utilisateur de savoir pourquoi. Ce
// timeout garantit qu'on force le masquage du splash au bout de 8s dans tous les cas, quitte
// à afficher un écran incomplet plutôt qu'un splash figé pour toujours.
const SPLASH_SAFETY_TIMEOUT_MS = 8000;

function RootLayoutNav() {
  const { token, isLoading } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  const rootNavigationState = useRootNavigationState();

  const [fontsLoaded, fontError] = useFonts({
    'Satoshi-Regular': Outfit_400Regular,
    'Satoshi-SemiBold': Outfit_600SemiBold,
  });

  const notReady = isLoading || !rootNavigationState?.key || (!fontsLoaded && !fontError);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => {
      SplashScreen.hideAsync().catch(() => { });
      setTimedOut(true);
    }, SPLASH_SAFETY_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    // Doit attendre CHACUNE de ces trois conditions séparément (OR des "pas encore prêt"),
    // pas la combinaison précédente ((isLoading || !key) && !fontsLoaded && !fontError) : dès
    // que les polices finissaient de charger (fontsLoaded=true) alors que la session était
    // encore en cours de restauration (isLoading=true), le membre droit du && devenait faux et
    // la garde ne bloquait plus — le routage se décidait sur token===null (valeur initiale) et
    // redirigeait vers /auth/login même pour un utilisateur déjà connecté, avant que
    // restoreSession() (AuthContext) n'ait fini de relire le token stocké.
    if (notReady) return;

    const inAuthGroup = segments[0] === 'auth';

    if (!token && !inAuthGroup) {
      router.replace('/auth/login');
    } else if (token && inAuthGroup) {
      router.replace('/');
    }

    // Libérer l'écran de chargement natif une fois que le routage est décidé
    SplashScreen.hideAsync();
  }, [token, isLoading, segments, rootNavigationState?.key]);

  // Le filet de sécurité ci-dessus force le masquage du splash après 8s même si `notReady`
  // est encore vrai — sans cet écran, l'app affichait alors le contenu par défaut du Stack
  // (ou rien de cohérent, selon l'état exact où le blocage survenait) : un écran blanc, sans
  // aucune indication de ce qui bloque encore, plutôt qu'un splash au moins visible. On
  // affiche ici un état diagnosticable (avec la condition précise en cause) au lieu de
  // laisser deviner ; dès que `notReady` redevient faux, le rendu normal reprend seul.
  if (timedOut && notReady) {
    const reason = isLoading
      ? 'la session utilisateur'
      : !rootNavigationState?.key
        ? 'le routeur'
        : 'les polices';
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#0a0a0f' }}>
        <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 12, textAlign: 'center' }}>
          Mongain met du temps à démarrer
        </Text>
        <Text style={{ color: '#9ca3af', fontSize: 14, marginBottom: 24, textAlign: 'center' }}>
          En attente de : {reason}.
        </Text>
      </View>
    );
  }

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
