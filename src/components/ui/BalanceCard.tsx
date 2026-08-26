import { StyleSheet, Text, View } from 'react-native';
import type { useAppTheme } from '../../constants/theme';

// Carte de solde/cagnotte en tête d'écran — identique entre vault-detail.tsx et
// tontine-detail.tsx avant cette extraction.
export default function BalanceCard({ colors, label, amount, description }: {
    colors: ReturnType<typeof useAppTheme>;
    label: string;
    amount: string;
    description?: string;
}) {
    return (
        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
            <Text style={[styles.amount, { color: colors.textPrimary }]}>{amount}</Text>
            {description ? <Text style={[styles.description, { color: colors.textSecondary }]}>{description}</Text> : null}
        </View>
    );
}

const styles = StyleSheet.create({
    card: { borderRadius: 18, borderWidth: 1, padding: 20, marginBottom: 24 },
    label: { fontSize: 12.5, textTransform: 'uppercase', letterSpacing: 0.4 },
    amount: { fontSize: 28, fontWeight: '900', marginTop: 6 },
    description: { fontSize: 13.5, marginTop: 10, lineHeight: 19 },
});
