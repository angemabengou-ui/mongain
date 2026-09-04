import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '../context/AuthContext';

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

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#1a1d2e', justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#60A5FA" />
      </View>
    );
  }

  // Pas de session : ne rien rendre ici, _layout.tsx s'occupe déjà de rediriger vers
  // /auth/login dès que isLoading passe à false — dupliquer cette décision ici risquerait
  // de la faire diverger de la source de vérité unique.
  if (!token) return null;

  return <Redirect href={'/(tabs)' as any} />;
}
