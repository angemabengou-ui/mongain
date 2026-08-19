import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppTheme } from '../../constants/theme';

// Aucune intégration réelle avec SEEG/Edan n'existe côté backend (voir
// backend/src/routes/services.ts, /pay-bill gardé derrière ENABLE_UNVERIFIED_EXTERNAL_SERVICES) :
// débiter le client ici reviendrait à prendre son argent sans jamais livrer de jeton réel.
export default function ElectricityServiceScreen() {
    const COLORS = useAppTheme();
    const router = useRouter();
    const styles = getStyles(COLORS);

    return (
        <SafeAreaView style={styles.safeArea}>
            <View style={styles.header}>
                <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                    <Ionicons name="arrow-back" size={28} color={COLORS.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Électricité (EDAN)</Text>
                <View style={{ width: 28 }} />
            </View>

            <ScrollView contentContainerStyle={styles.content}>
                <View style={styles.card}>
                    <View style={{ alignItems: 'center' }}>
                        <View style={[styles.iconWrap, { backgroundColor: '#f59e0b15' }]}>
                            <Ionicons name="construct-outline" size={40} color="#f59e0b" />
                        </View>
                        <Text style={styles.title}>SEEG / EDAN</Text>
                        <Text style={[styles.subtitle, { textAlign: 'center', marginTop: 12 }]}>
                            Pas encore connecté à SEEG. Cette fonctionnalité est en cours de déploiement — aucun jeton d'électricité ne peut encore être livré, elle reste désactivée pour ne pas débiter votre solde sans contrepartie.
                        </Text>
                    </View>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

const getStyles = (COLORS: ReturnType<typeof useAppTheme>) => StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: COLORS.background },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, paddingVertical: 16, backgroundColor: COLORS.surface,
        shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
    },
    backButton: { padding: 8, marginLeft: -8 },
    headerTitle: { fontSize: 18, fontWeight: '700', color: COLORS.textPrimary },
    content: { flexGrow: 1, padding: 24 },
    card: { backgroundColor: COLORS.surface, borderRadius: 24, padding: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 12, elevation: 4 },
    iconWrap: { backgroundColor: COLORS.primary + '15', padding: 16, borderRadius: 50, marginBottom: 12 },
    title: { fontSize: 22, fontWeight: '800', color: COLORS.textPrimary },
    subtitle: { fontSize: 14, color: COLORS.textSecondary, marginTop: 4 },
});
