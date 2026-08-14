import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAppTheme } from '../constants/theme';
import { useAuth } from '../context/AuthContext';

export default function WithdrawScreen() {
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);
    const router = useRouter();
    const { user } = useAuth();

    const [showCode, setShowCode] = useState(false);
    const [token, setToken] = useState('000 000');

    const generateCode = () => {
        const pass = Math.floor(100000 + Math.random() * 900000).toString();
        setToken(pass.slice(0, 3) + ' ' + pass.slice(3, 6));
        setShowCode(true);
    };

    if (showCode) {
        return (
            <SafeAreaView style={[styles.safeArea, { justifyContent: 'center', alignItems: 'center', padding: 24 }]}>
                <View style={[styles.iconWrap, { backgroundColor: '#10B98115', padding: 24, borderRadius: 50, marginBottom: 24, width: 100, height: 100 }]}>
                    <Ionicons name="lock-closed" size={50} color="#10B981" />
                </View>
                <Text style={styles.codeGenTitle}>Code Secret Généré</Text>
                <Text style={[styles.codeGenSubtitle, { textAlign: 'center', marginTop: 12, paddingHorizontal: 20 }]}>
                    Veuillez communiquer ce code à 6 chiffres à votre Agent Mongain pour valider le retrait.
                </Text>

                <View style={styles.codeContainer}>
                    <Text style={styles.codeText}>{token}</Text>
                </View>

                <Text style={[styles.codeGenSubtitle, { color: '#EF4444', fontWeight: 'bold' }]}>EXPIRATION DANS 05:00</Text>

                <TouchableOpacity style={[styles.btn, { width: '100%', marginTop: 60 }]} onPress={() => setShowCode(false)}>
                    <Text style={styles.btnText}>Fermer</Text>
                </TouchableOpacity>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.safeArea}>
            <View style={styles.header}>
                <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                    <Ionicons name="arrow-back" size={28} color={COLORS.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Retrait</Text>
                <View style={{ width: 44 }} />
            </View>

            <ScrollView contentContainerStyle={styles.container}>
                <View style={styles.balanceSection}>
                    <Text style={styles.balanceLabel}>Solde Retirable</Text>
                    <Text style={styles.balanceAmount}>{(user?.wallet?.balance || 0).toLocaleString('fr-FR')} FCFA</Text>
                </View>

                <Text style={styles.sectionHeader}>PAR QR SCANCER</Text>

                <View style={styles.listContainer}>
                    <TouchableOpacity style={styles.listItem} onPress={() => router.push('/qr?mode=scanOnly&intent=withdraw')}>
                        <View style={[styles.listIcon, { backgroundColor: '#F59E0B15' }]}>
                            <Ionicons name="scan" size={24} color="#F59E0B" />
                        </View>
                        <View style={styles.listTextWrap}>
                            <Text style={styles.listTitle}>Scanner pour retirer</Text>
                            <Text style={styles.listDesc}>Saisissez vous-même le montant à retirer.</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={20} color={COLORS.textSecondary} />
                    </TouchableOpacity>
                </View>

                <Text style={styles.sectionHeader}>PAR CODE SECRET</Text>

                <View style={styles.listContainer}>
                    <TouchableOpacity style={styles.listItem} onPress={generateCode}>
                        <View style={[styles.listIcon, { backgroundColor: '#10B98115' }]}>
                            <Ionicons name="lock-closed" size={24} color="#10B981" />
                        </View>
                        <View style={styles.listTextWrap}>
                            <Text style={styles.listTitle}>Générer un Code (Guichet)</Text>
                            <Text style={styles.listDesc}>Donnez votre numéro et le code généré au caissier.</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={20} color={COLORS.textSecondary} />
                    </TouchableOpacity>
                </View>

                <Text style={styles.sectionHeader}>PORTFEUILLES MOBILES ET BANQUES</Text>

                <View style={styles.listContainer}>
                    <TouchableOpacity onPress={() => { }} disabled={true} style={[styles.listItem, { opacity: 0.5 }]}>
                        <View style={[styles.listIcon, { backgroundColor: '#EF444415' }]}>
                            <Ionicons name="phone-portrait" size={24} color="#EF4444" />
                        </View>
                        <View style={styles.listTextWrap}>
                            <Text style={styles.listTitle}>Vers Airtel Money</Text>
                            <Text style={styles.listDesc}>Virement instantané (Bientôt disponible)</Text>
                        </View>
                    </TouchableOpacity>

                    <TouchableOpacity onPress={() => { }} disabled={true} style={[styles.listItem, styles.lastListItem, { opacity: 0.5 }]}>
                        <View style={[styles.listIcon, { backgroundColor: '#3B82F615' }]}>
                            <Ionicons name="phone-portrait-outline" size={24} color="#3B82F6" />
                        </View>
                        <View style={styles.listTextWrap}>
                            <Text style={styles.listTitle}>Vers Moov Africa</Text>
                            <Text style={styles.listDesc}>Virement instantané (Bientôt disponible)</Text>
                        </View>
                    </TouchableOpacity>
                </View>

            </ScrollView>
        </SafeAreaView>
    );
}

const getStyles = (COLORS: ReturnType<typeof useAppTheme>) => StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: COLORS.background },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16, backgroundColor: COLORS.background },
    backButton: { padding: 8, marginLeft: -8 },
    headerTitle: { fontSize: 20, fontWeight: '800', color: COLORS.textPrimary },
    container: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 60 },

    balanceSection: { alignItems: 'center', marginVertical: 32 },
    balanceLabel: { fontSize: 14, color: COLORS.textSecondary, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 },
    balanceAmount: { fontSize: 44, fontWeight: '900', color: COLORS.textPrimary, marginVertical: 8, letterSpacing: -1 },

    sectionHeader: { fontSize: 13, fontWeight: '700', color: COLORS.textSecondary, marginTop: 24, marginBottom: 12, marginLeft: 16, letterSpacing: 0.5 },

    listContainer: { backgroundColor: COLORS.surface, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.border, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.03, shadowRadius: 8, elevation: 1 },
    listItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border },
    lastListItem: { borderBottomWidth: 0 },
    listIcon: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 16 },
    listTextWrap: { flex: 1, marginRight: 8 },
    listTitle: { fontSize: 16, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 4 },
    listDesc: { fontSize: 13, color: COLORS.textSecondary, lineHeight: 18 },

    iconWrap: { justifyContent: 'center', alignItems: 'center' },
    codeGenTitle: { fontSize: 24, fontWeight: '800', color: COLORS.textPrimary, textAlign: 'center' },
    codeGenSubtitle: { fontSize: 15, color: COLORS.textSecondary, textAlign: 'center' },
    codeContainer: { paddingHorizontal: 40, paddingVertical: 20, borderRadius: 20, marginVertical: 32, borderWidth: 2, borderColor: '#10B981', backgroundColor: '#10B98110' },
    codeText: { fontSize: 48, fontWeight: '900', color: COLORS.textPrimary, letterSpacing: 5 },
    btn: { backgroundColor: '#10B981', height: 56, borderRadius: 16, justifyContent: 'center', alignItems: 'center', shadowColor: '#10B981', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 },
    btnText: { color: '#fff', fontSize: 16, fontWeight: '700' }
});
