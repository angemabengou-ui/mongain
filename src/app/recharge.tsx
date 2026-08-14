import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAppTheme } from '../constants/theme';

export default function RechargeScreen() {
    const COLORS = useAppTheme();
    const router = useRouter();

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: COLORS.background }]}>
            <View style={[styles.header, { backgroundColor: COLORS.background }]}>
                <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                    <Ionicons name="arrow-back" size={28} color={COLORS.textPrimary} />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: COLORS.textPrimary }]}>Dépôt</Text>
                <View style={{ width: 44 }} />
            </View>

            <ScrollView contentContainerStyle={styles.container}>

                <View style={styles.heroSection}>
                    <Text style={[styles.heroTitle, { color: COLORS.textPrimary }]}>Alimenter my Mongain</Text>
                    <Text style={[styles.heroSubtitle, { color: COLORS.textSecondary }]}>Sélectionnez l'origine des fonds</Text>
                </View>

                <Text style={[styles.sectionHeader, { color: COLORS.textSecondary }]}>PRÉLÈVEMENT MOBILE MONEY</Text>

                <View style={[styles.listContainer, { backgroundColor: COLORS.surface, borderColor: COLORS.border }]}>
                    <TouchableOpacity style={[styles.listItem, { borderBottomColor: COLORS.border }]} onPress={() => router.push({ pathname: '/recharge-form', params: { method: 'AIRTEL' } })}>
                        <View style={[styles.listIcon, { backgroundColor: '#EF444415' }]}>
                            <Ionicons name="phone-portrait" size={24} color="#EF4444" />
                        </View>
                        <View style={styles.listTextWrap}>
                            <Text style={[styles.listTitle, { color: COLORS.textPrimary }]}>Airtel Money</Text>
                            <Text style={[styles.listDesc, { color: COLORS.textSecondary }]}>Débité depuis votre solde Airtel.</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={20} color={COLORS.textSecondary} />
                    </TouchableOpacity>

                    <TouchableOpacity style={styles.lastListItem} onPress={() => router.push({ pathname: '/recharge-form', params: { method: 'MOOV' } })}>
                        <View style={[styles.listIcon, { backgroundColor: '#3B82F615' }]}>
                            <Ionicons name="phone-portrait-outline" size={24} color="#3B82F6" />
                        </View>
                        <View style={styles.listTextWrap}>
                            <Text style={[styles.listTitle, { color: COLORS.textPrimary }]}>Moov Africa</Text>
                            <Text style={[styles.listDesc, { color: COLORS.textSecondary }]}>Débité depuis votre solde Moov.</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={20} color={COLORS.textSecondary} />
                    </TouchableOpacity>
                </View>

                <Text style={[styles.sectionHeader, { color: COLORS.textSecondary, marginTop: 32 }]}>PAR DÉPÔT EN AGENCE</Text>

                <View style={[styles.infoBox, { backgroundColor: COLORS.primary + '10', borderColor: COLORS.primary + '20' }]}>
                    <Ionicons name="information-circle" size={28} color={COLORS.primary} style={{ marginRight: 12 }} />
                    <View style={{ flex: 1 }}>
                        <Text style={[styles.infoTitle, { color: COLORS.primary }]}>Numéro Utilisateur Mongain</Text>
                        <Text style={[styles.infoText, { color: COLORS.primary }]}>Pour déposer du Cash, rendez-vous chez un Agent Mongain et communiquez-lui simplement votre numéro de profil.</Text>
                    </View>
                </View>

            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16 },
    backButton: { padding: 8, marginLeft: -8 },
    headerTitle: { fontSize: 20, fontWeight: '800' },
    container: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 60 },

    heroSection: { marginVertical: 24, alignItems: 'center' },
    heroTitle: { fontSize: 28, fontWeight: '900', marginBottom: 8, letterSpacing: -0.5 },
    heroSubtitle: { fontSize: 16 },

    sectionHeader: { fontSize: 13, fontWeight: '700', marginBottom: 12, marginLeft: 16, letterSpacing: 0.5 },

    listContainer: { borderRadius: 20, overflow: 'hidden', borderWidth: 1, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.03, shadowRadius: 8, elevation: 1 },
    listItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 16, borderBottomWidth: 1 },
    lastListItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 16, borderBottomWidth: 0 },
    listIcon: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 16 },
    listTextWrap: { flex: 1, marginRight: 8 },
    listTitle: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
    listDesc: { fontSize: 13, lineHeight: 18 },

    infoBox: { flexDirection: 'row', alignItems: 'flex-start', padding: 20, borderRadius: 20, borderWidth: 1 },
    infoTitle: { fontSize: 16, fontWeight: '800', marginBottom: 4 },
    infoText: { fontSize: 13, fontWeight: '500', lineHeight: 20 }
});
