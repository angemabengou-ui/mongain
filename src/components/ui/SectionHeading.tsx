import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { useAppTheme } from '../../constants/theme';

// Titre de section + icône d'action optionnelle à droite (ex : ouvrir le formulaire
// d'invitation) — même structure dans vault-detail.tsx et tontine-detail.tsx avant
// cette extraction, avec un espacement au-dessus qui diffère selon le contexte d'où
// `marginTop` reste un prop plutôt qu'une valeur figée.
export default function SectionHeading({ colors, title, marginTop = 4, marginBottom = 10, actionIcon, onAction }: {
    colors: ReturnType<typeof useAppTheme>;
    title: string;
    marginTop?: number;
    // Les titres portant une icône d'action (ligne flex, ex : inviter) n'avaient
    // historiquement aucune marge basse propre — passer marginBottom={0} à l'appel pour
    // reproduire ce cas, plutôt que la déduire implicitement de la présence d'actionIcon.
    marginBottom?: number;
    actionIcon?: keyof typeof Ionicons.glyphMap;
    onAction?: () => void;
}) {
    return (
        <View style={[styles.row, { marginTop }]}>
            <Text style={[styles.title, { color: colors.textPrimary, marginBottom }]}>{title}</Text>
            {actionIcon && onAction && (
                // accessibilityLabel=title : l'icône seule n'avait jusqu'ici aucun libellé
                // (ni pour un lecteur d'écran, ni pour cibler ce bouton dans un test) — le titre
                // affiché juste à côté n'est PAS un descendant de ce bouton (ligne flex, simples
                // frères), donc jamais pressable lui-même malgré les apparences visuelles.
                <TouchableOpacity onPress={onAction} accessibilityLabel={title}>
                    <Ionicons name={actionIcon} size={20} color={colors.primary} />
                </TouchableOpacity>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    title: { fontSize: 15, fontWeight: '700' },
});
