import { Redirect } from 'expo-router';

// Redirige automatiquement vers le groupe tabs (accueil + onglets)
export default function Index() {
  return <Redirect href={'/(tabs)' as any} />;
}
