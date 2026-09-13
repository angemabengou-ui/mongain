import { Redirect, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../context/AuthContext';

// Filet de sécurité : signalé après un changement de build/projet EAS (cause exacte non
// confirmée avec certitude — cet écran restait bloqué indéfiniment sur l'indicateur de
// chargement ci-dessous, sans jamais basculer vers /auth/login, alors que la redirection
// normale (gérée par _layout.tsx, voir son commentaire) n'aurait dû laisser cet écran visible
// que quelques centaines de ms au pire. Après ce délai, on force nous-mêmes la navigation vers
// la connexion, indépendamment de ce qui bloque la redirection normale — un utilisateur avec
// une session valide aura de toute façon déjà quitté cet écran (vers /(tabs)) bien avant que ce
// délai n'expire dans le cas nominal, `restoreSession` (AuthContext) débloquant isLoading/token
// de façon quasi instantanée dès qu'un token est trouvé en local, sans attendre le réseau.
const STUCK_SAFETY_TIMEOUT_MS = 6000;

// Redirige automatiquement vers le groupe tabs (accueil + onglets) — mais seulement une fois
// la session restaurée. Avant ce correctif, la redirection était inconditionnelle et se
// déclenchait dès le premier rendu, souvent AVANT que le useEffect de _layout.tsx (seul
// endroit qui décide vraiment entre /auth/login et l'app) n'ait eu la moindre chance de
// s'exécuter (isLoading démarre à true, token à null). Résultat sur un démarrage à froid
// sans session valide : le Dashboard montait quand même, son useFocusEffect appelait
// aussitôt apiGetBalance()/apiGetTransactions() avec un token absent/périmé, provoquant des
// 401 et un déclenchement prématuré de la déconnexion forcée — avant même que _layout.tsx
// n'ait redirigé vers /auth/login. Même classe de course que le chargement des polices déjà
// corrigé dans _layout.tsx.
export default function Index() {
  const { token, isLoading } = useAuth();
  const router = useRouter();
  const [forceLogin, setForceLogin] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => setForceLogin(true), STUCK_SAFETY_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    // Revérifié au moment où le délai expire (pas figé à sa programmation) : si la navigation
    // normale a fini par aboutir entre-temps, ce composant est déjà démonté et cet effet ne
    // s'exécute jamais — cette double vérification ne sert que le cas où il est encore monté.
    if (forceLogin && (isLoading || !token)) {
      router.replace('/auth/login');
    }
  }, [forceLogin, isLoading, token, router]);

  // ÉCRAN BLANC AU DÉMARRAGE (signalé par des utilisateurs) : isLoading (AuthContext) peut
  // repasser à false AVANT que `notReady` de _layout.tsx (qui attend EN PLUS le chargement des
  // polices ET le montage du routeur, pas seulement la session) ne se résolve — c'est même le
  // cas le plus fréquent sur un démarrage à froid SANS session stockée, où restoreSession()
  // se termine quasi instantanément. Pendant cette fenêtre, cet écran ("/") reste le seul
  // actuellement monté, en attendant que _layout.tsx exécute son propre redirect vers
  // /auth/login. Un `return null` ici (comme avant ce correctif) laissait alors voir le fond
  // blanc par défaut de React Native — exactement l'écran blanc rapporté, potentiellement
  // visible plusieurs centaines de ms à quelques secondes sur un appareil lent ou un build
  // release, le temps que la navigation se termine. On garde donc TOUJOURS un indicateur de
  // chargement affiché (jamais un rendu vide) tant que ni la session ni le token ne sont
  // confirmés ; la redirection elle-même reste entièrement gérée par _layout.tsx (source de
  // vérité unique) pour ne pas la faire diverger.
  if (isLoading || !token) {
    return (
      <View style={{ flex: 1, backgroundColor: '#1a1d2e', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#60A5FA" />
      </View>
    );
  }

  return <Redirect href={'/(tabs)' as any} />;
}
