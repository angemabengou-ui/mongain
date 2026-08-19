import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppTheme } from '../../constants/theme';

// Aucune intégration réelle avec Airtel/Moov n'existe côté backend (voir
// backend/src/routes/services.ts, /topup gardé derrière ENABLE_UNVERIFIED_EXTERNAL_SERVICES) :
// débiter le client ici reviendrait à prendre son argent sans jamais livrer de crédit réel.
export default function AirtimeScreen() {
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);
    const router = useRouter();

    return (
        <SafeAreaView style={styles.safeArea}>
            <ScrollView contentContainerStyle={styles.scroll}>
                <View style={styles.header}>
                    <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                        <Ionicons name="arrow-back" size={28} color={COLORS.textPrimary} />
                    </TouchableOpacity>
                    <Text style={styles.headerTitle}>Crédit d'appel</Text>
                </View>

                <View style={styles.card}>
                    <View style={{ alignItems: 'center' }}>
                        <View style={[styles.iconWrap, { backgroundColor: '#f59e0b15' }]}>
                            <Ionicons name="construct-outline" size={40} color="#f59e0b" />
                        </View>
                        <Text style={styles.title}>Recharge Mobile</Text>
                        <Text style={[styles.subtitle, { textAlign: 'center', marginTop: 12 }]}>
                            Pas encore connecté à Airtel/Moov. Cette fonctionnalité est en cours de déploiement — aucun crédit ne peut encore être livré, elle reste désactivée pour ne pas débiter votre solde sans contrepartie.
                        </Text>
                    </View>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

const getStyles = (COLORS: ReturnType<typeof useAppTheme>) => StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: COLORS.background },
    scroll: { flexGrow: 1, padding: 24 },
    header: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
    backButton: { marginRight: 16 },
    headerTitle: { fontSize: 24, fontWeight: '800', color: COLORS.textPrimary },
    card: { backgroundColor: COLORS.surface, borderRadius: 24, padding: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 12, elevation: 4 },
    iconWrap: { backgroundColor: COLORS.primary + '15', padding: 16, borderRadius: 50, marginBottom: 12 },
    title: { fontSize: 22, fontWeight: '800', color: COLORS.textPrimary },
    subtitle: { fontSize: 14, color: COLORS.textSecondary, marginTop: 4 },
});
