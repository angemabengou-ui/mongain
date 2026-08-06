import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import {
    KeyboardAvoidingView,
    Platform,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

const COLORS = {
    primary: '#10b981',
    surface: '#ffffff',
    background: '#f8f9fe',
    textPrimary: '#1a1d2e',
    textSecondary: '#6b7280',
};

export default function TontineServiceScreen() {
    const router = useRouter();

    return (
        <SafeAreaView style={styles.safeArea}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
                <View style={styles.header}>
                    <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                        <Ionicons name="arrow-back" size={28} color={COLORS.textPrimary} />
                    </TouchableOpacity>
                    <Text style={styles.headerTitle}>Tontine</Text>
                    <View style={{ width: 28 }} />
                </View>

                <ScrollView contentContainerStyle={styles.content}>

                    <View style={styles.heroCard}>
                        <Ionicons name="lock-closed" size={60} color="#fff" />
                        <Text style={{ color: '#fff', fontSize: 24, fontWeight: '800', marginTop: 15 }}>Bientôt Disponible</Text>
                        <Text style={{ color: '#ecfdf5', fontSize: 15, textAlign: 'center', marginTop: 10, lineHeight: 22 }}>
                            L'épargne communautaire simplifiée. Cotisez avec vos proches en toute sécurité directement depuis Mongain.
                        </Text>
                    </View>

                    <View style={styles.featureBox}>
                        <Ionicons name="people" size={32} color={COLORS.primary} />
                        <View style={{ marginLeft: 16, flex: 1 }}>
                            <Text style={styles.featureTitle}>Groupes Privés</Text>
                            <Text style={styles.featureDesc}>Créez des coffres avec vos proches et définissez les tours de retrait.</Text>
                        </View>
                    </View>

                    <View style={styles.featureBox}>
                        <Ionicons name="shield-checkmark" size={32} color={COLORS.primary} />
                        <View style={{ marginLeft: 16, flex: 1 }}>
                            <Text style={styles.featureTitle}>Fonds Garantis</Text>
                            <Text style={styles.featureDesc}>Vos dépôts sont gelés avec la même sécurité que la voûte centrale.</Text>
                        </View>
                    </View>

                    <View style={styles.featureBox}>
                        <Ionicons name="calendar" size={32} color={COLORS.primary} />
                        <View style={{ marginLeft: 16, flex: 1 }}>
                            <Text style={styles.featureTitle}>Prélèvements Autos</Text>
                            <Text style={styles.featureDesc}>Fini les retards. Les quotes-parts sont débitées automatiquement selon le cycle.</Text>
                        </View>
                    </View>

                    <TouchableOpacity style={styles.actionBtn} onPress={() => router.back()}>
                        <Text style={styles.actionBtnText}>Retour à l'accueil</Text>
                    </TouchableOpacity>
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: COLORS.background },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, paddingVertical: 16, backgroundColor: COLORS.surface,
        shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
    },
    backButton: { padding: 8, marginLeft: -8 },
    headerTitle: { fontSize: 18, fontWeight: '700', color: COLORS.textPrimary },
    content: { padding: 24 },

    heroCard: {
        backgroundColor: '#10b981',
        padding: 30, borderRadius: 24, marginBottom: 30, alignItems: 'center',
        shadowColor: '#10b981', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.2, shadowRadius: 15, elevation: 8
    },

    featureBox: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: COLORS.surface,
        padding: 20,
        borderRadius: 16,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#e2e8f0',
    },
    featureTitle: { fontSize: 16, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 4 },
    featureDesc: { fontSize: 13, color: COLORS.textSecondary, lineHeight: 18 },

    actionBtn: { backgroundColor: '#f1f5f9', height: 60, borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginTop: 20 },
    actionBtnText: { color: COLORS.textPrimary, fontSize: 16, fontWeight: '700' },
});
