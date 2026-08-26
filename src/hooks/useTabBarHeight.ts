import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export const TAB_BAR_HEIGHT_BASE = 65;

// La tab bar custom ((tabs)/_layout.tsx) est en position absolute : elle flotte
// par-dessus le contenu de chaque onglet plutôt que de réserver sa place dans le flux.
// Sans compenser ce chevauchement dans le padding bas de CHAQUE écran d'onglet, les
// derniers éléments d'une liste (accueil, historique, profil) finissent visuellement
// coupés ou cachés derrière la barre. Seule source de vérité pour ce calcul — partagée
// avec _layout.tsx — pour qu'une dérive entre les deux ne fasse pas revenir le bug.
export function useTabBarHeight() {
    const insets = useSafeAreaInsets();
    // Sur Android, l'affichage edge-to-edge (imposé par défaut dès Expo SDK 54, non
    // désactivable à partir d'Android 16) fait parfois remonter insets.bottom à 0 en
    // navigation 3 boutons au lieu de la vraie hauteur de cette barre système — plancher
    // défensif de 24px pour ne jamais se retrouver sans marge du tout.
    const bottomInset = Platform.OS === 'android' ? Math.max(insets.bottom, 24) : insets.bottom;
    return TAB_BAR_HEIGHT_BASE + bottomInset;
}
