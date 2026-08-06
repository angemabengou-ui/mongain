import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAppTheme } from '../constants/theme';

export default function WithdrawTypeScreen() {
    const router = useRouter();
    const COLORS = useAppTheme();

    return (
        <SafeAreaView style={styles.safeArea}>
            <View style={styles.header}>
                <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                    <Ionicons name="arrow-back" size={28} color={COLORS.textPrimary || '#1e293b'} />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: COLORS.textPrimary || '#1e293b' }]}>Retrait d'Argent</Text>
                <View style={{ width: 40 }} />
            </View>

            <View style={styles.content}>
                <Text style={[styles.title, { color: COLORS.textPrimary || '#1e293b' }]}>Où souhaitez-vous retirer ?</Text>
                <Text style={styles.subtitle}>Sélectionnez le type de point de retrait pour générer votre jeton.</Text>

                <TouchableOpacity
                    style={[styles.card, { borderColor: '#10B981', backgroundColor: '#ECFDF5' }]}
                    onPress={() => router.push({ pathname: '/withdraw-code', params: { type: 'agent' } })}
                >
                    <View style={[styles.iconWrapper, { backgroundColor: '#D1FAE5' }]}>
                        <Ionicons name="business" size={32} color="#059669" />
                    </View>
                    <View style={styles.cardContent}>
                        <Text style={[styles.cardTitle, { color: '#065F46' }]}>Agence Mongain</Text>
                        <Text style={styles.cardDesc}>Retrait gratuit dans nos agences.</Text>
                        <View style={styles.badgeFree}>
                            <Text style={styles.badgeFreeText}>Frais : 0 FCFA</Text>
                        </View>
                    </View>
                    <Ionicons name="chevron-forward" size={24} color="#059669" />
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.card, { borderColor: '#F59E0B', backgroundColor: '#FFFBEB' }]}
                    onPress={() => router.push({ pathname: '/withdraw-code', params: { type: 'merchant' } })}
                >
                    <View style={[styles.iconWrapper, { backgroundColor: '#FEF3C7' }]}>
                        <Ionicons name="storefront" size={32} color="#D97706" />
                    </View>
                    <View style={styles.cardContent}>
                        <Text style={[styles.cardTitle, { color: '#92400E' }]}>Commerçant Agréé</Text>
                        <Text style={styles.cardDesc}>Retrait de proximité chez un commerçant.</Text>
                        <View style={styles.badgeFee}>
                            <Text style={styles.badgeFeeText}>Frais estimés : 1.30%</Text>
                        </View>
                    </View>
                    <Ionicons name="chevron-forward" size={24} color="#D97706" />
                </TouchableOpacity>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: '#f8fafc' },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, paddingVertical: 16,
    },
    backButton: { padding: 8, marginLeft: -8 },
    headerTitle: { fontSize: 18, fontWeight: '700' },
    content: { padding: 24, flex: 1 },
    title: { fontSize: 24, fontWeight: '800', marginBottom: 8 },
    subtitle: { fontSize: 15, color: '#64748b', marginBottom: 32, lineHeight: 22 },

    card: {
        flexDirection: 'row', alignItems: 'center',
        padding: 20, borderRadius: 20, borderWidth: 2,
        marginBottom: 16,
    },
    iconWrapper: {
        width: 56, height: 56, borderRadius: 28,
        justifyContent: 'center', alignItems: 'center',
        marginRight: 16
    },
    cardContent: { flex: 1 },
    cardTitle: { fontSize: 18, fontWeight: '800', marginBottom: 4 },
    cardDesc: { fontSize: 13, color: '#64748b', marginBottom: 12 },
    badgeFree: { alignSelf: 'flex-start', backgroundColor: '#10B981', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
    badgeFreeText: { color: '#fff', fontSize: 12, fontWeight: '800' },
    badgeFee: { alignSelf: 'flex-start', backgroundColor: '#F59E0B', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
    badgeFeeText: { color: '#fff', fontSize: 12, fontWeight: '800' },
});
