import { Outfit_400Regular, Outfit_600SemiBold } from '@expo-google-fonts/outfit';
import { useFonts } from 'expo-font';
import { Stack, useRootNavigationState, useRouter, useSegments, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { InvoiceApprover } from '../components/InvoiceApprover';
import { AuthProvider, useAuth } from '../context/AuthContext';
import { getTillToken } from '../services/api';

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

  // Session GUICHET (MerchantTill, voir getTillToken/saveTillToken, services/api.ts) —
  // totalement indépendante d'AuthContext (pas de refresh token, pas de `user`) : un guichet
  // peut être actif SANS aucune session utilisateur normale sur l'appareil, et vice versa.
  // Relu à chaque changement de route (dépendance `segments`) plutôt qu'une seule fois au
  // montage : c'est le seul moyen de détecter à la volée la connexion depuis till-login.tsx
  // (saveTillToken) et la déconnexion depuis till-collect.tsx (deleteTillToken), aucune des
  // deux ne passant par AuthContext pour notifier ce layout. Erreur → traitée comme "pas de
  // session guichet" (jamais bloquant pour le reste du garde-fou ci-dessous).
  const [tillToken, setTillToken] = useState<string | null>(null);
  // Distinct de `tillToken` : reste faux tant que la PREMIÈRE lecture n'a pas abouti (succès
  // OU échec) — sans lui, l'effet de redirection ci-dessous ne pourrait pas distinguer "pas de
  // session guichet" (tillToken=null après lecture) de "pas encore su" (tillToken=null car
  // encore sa valeur initiale), et redirigerait par erreur vers /auth/login avant même de
  // savoir qu'un guichet est actif (flash confirmé par un test dédié, voir plus bas).
  const [tillChecked, setTillChecked] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getTillToken()
      .then(t => { if (!cancelled) setTillToken(t); })
      .catch(() => { if (!cancelled) setTillToken(null); })
      .finally(() => { if (!cancelled) setTillChecked(true); });
    return () => { cancelled = true; };
  }, [segments]);

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
    // Voir tillChecked ci-dessus : sans cette garde, ce guard s'exécuterait AVANT même de
    // savoir si une session guichet est active, forçant à tort /auth/login pendant l'instant
    // où tillToken vaut encore sa valeur initiale (null) — un flash de navigation réel, pas
    // qu'un artefact de test (voir garde-fou session GUICHET, _layout.test.tsx).
    if (notReady || !tillChecked) return;

    const inAuthGroup = segments[0] === 'auth';
    // /till-login et /till-collect restent librement accessibles même sans AUCUNE session
    // utilisateur normale sur l'appareil (un caissier n'a pas de compte Mongain) — sans cette
    // exemption, `!token && !inAuthGroup` ci-dessous forcerait /auth/login dès l'arrivée sur
    // till-login.tsx, empêchant toute connexion guichet. Le garde-fou dédié plus bas (basé sur
    // tillToken) prend le relais une fois la session guichet effectivement active.
    const inTillGroup = segments[0] === 'till-login' || segments[0] === 'till-collect';

    // `!tillToken` ci-dessous (en plus de `!inTillGroup`) : une session guichet active doit
    // bloquer TOUTE redirection décidée ici, même si la route actuelle n'est ni till-login ni
    // till-collect (ex : un ancien lien profond vers une autre route) — c'est alors au seul
    // garde-fou dédié plus bas (basé sur tillToken) de renvoyer vers /till-collect, jamais à
    // celui-ci de renvoyer vers /auth/login entre-temps.
    if (!inTillGroup && !tillToken) {
      if (!token && !inAuthGroup) {
        router.replace('/auth/login');
      } else if (token && inAuthGroup) {
        router.replace('/');
      }
    }

    // Libérer l'écran de chargement natif une fois que le routage est décidé
    SplashScreen.hideAsync();
  }, [token, isLoading, segments, rootNavigationState?.key, tillToken, tillChecked]);

  // Garde-fou GUICHET — prioritaire sur tout le reste : tant qu'une session guichet est
  // active (tillToken non nul), TOUT le reste de l'app reste inaccessible, quelle que soit la
  // route visée (deep link, navigation programmée, historique...). Effet séparé de celui
  // ci-dessus (jamais fusionné) : celui-ci ne dépend PAS de `notReady`/`isLoading`
  // (AuthContext) — une session guichet n'a rien à voir avec la session utilisateur normale et
  // ne doit jamais attendre sa résolution — seulement du routeur lui-même (rootNavigationState),
  // sans quoi router.replace() ci-dessous pourrait s'exécuter avant que le Stack ne soit monté.
  useEffect(() => {
    if (!rootNavigationState?.key) return;
    if (tillToken && segments[0] !== 'till-collect') {
      router.replace('/till-collect');
    }
  }, [tillToken, segments, rootNavigationState?.key]);

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
