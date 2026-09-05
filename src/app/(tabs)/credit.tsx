import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { apiApplyCredit, apiGetActiveLoans, apiGetCreditEligibility, apiRepayCredit } from '../../services/api';

const TrustGauge = ({ score, styles }: { score: number, styles: any }) => {
    // Score arbitraire max 500 pour visualisation du niveau de confiance
    const maxScore = 500;
    const percentage = Math.min(Math.max((score / maxScore) * 100, 0), 100);

    let color = '#E63946'; // Rouge (Faible confiance)
    if (percentage > 40) color = '#F4A261'; // Orange (Moyen)
    if (percentage > 70) color = '#2A9D8F'; // Vert (Confiance Élevée)

    return (
        <View style={styles.gaugeContainer}>
            <View style={styles.gaugeLabels}>
                <Text style={styles.gaugeTitle}>Score de Confiance</Text>
                <Text style={[styles.scoreText, { color }]}>{score} / {maxScore}</Text>
            </View>
            <View style={styles.gaugeBackground}>
                <View style={[styles.gaugeFill, { width: `${percentage}%`, backgroundColor: color }]} />
            </View>
            <Text style={styles.gaugeHint}>Plus vous utilisez Mongain, plus votre capacité d'emprunt augmente.</Text>
        </View>
    );
};

export default function CreditScreen() {
    const { token } = useAuth();
    const router = useRouter();
    const COLORS = useAppTheme();
    const insets = useSafeAreaInsets();
    const styles = getStyles(COLORS);

    const [loading, setLoading] = useState(true);
    const [eligibility, setEligibility] = useState<any>(null);
    const [activeLoans, setActiveLoans] = useState<any[]>([]);
    const [actionLoading, setActionLoading] = useState(false);

    const loadData = async () => {
        try {
            setLoading(true);
            const [eligRes, loansRes] = await Promise.all([
                apiGetCreditEligibility(),
                apiGetActiveLoans()
            ]);
            setEligibility(eligRes);
            setActiveLoans(loansRes);
        } catch (e: any) {
            Alert.alert("Erreur", e.response?.data?.error || "Impossible de charger les données de crédit");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (token) {
            loadData();
        }
    }, [token]);

    const handleApply = async () => {
        if (!eligibility || !eligibility.eligible) {
            Alert.alert("Accès Refusé", "Vous n'êtes pas encore éligible au crédit Mongain.");
            return;
        }

        Alert.alert(
            "Confirmer le Crédit",
            `Souhaitez-vous débloquer un crédit de ${eligibility.maxAmount.toLocaleString('fr-FR')} FCFA ?\n\nTaux: ${(eligibility.interestRate * 100).toFixed(1)}%\nDurée: 30 Jours`,
            [
                { text: "Annuler", style: "cancel" },
                {
                    text: "Débloquer",
                    onPress: () => {
                        Alert.prompt(
                            'Confirmer le crédit',
                            'Saisissez votre code PIN Mongain pour débloquer ce crédit.',
                            [
                                { text: 'Annuler', style: 'cancel' },
                                { text: 'Confirmer', onPress: (pin?: string) => executeApply(pin) },
                            ],
                            'secure-text',
                        );
                    }
                }
            ]
        );
    };

    const executeApply = async (pin?: string) => {
        if (!pin) return Alert.alert("Erreur", "Code PIN requis.");
        setActionLoading(true);
        try {
            const res = await apiApplyCredit(eligibility.maxAmount, pin);
            Alert.alert("Succès", "Les fonds ont été virés sur votre portefeuille ! 🎉");
            await loadData();
        } catch (error: any) {
            Alert.alert('Erreur', error.response?.data?.error || 'Opération échouée');
        } finally {
            setActionLoading(false);
        }
    };

    const handleRepay = async (loanId: string, amountOwed: number) => {
        Alert.alert(
            "Remboursement",
            `Voulez-vous rembourser le solde total de ${amountOwed.toLocaleString('fr-FR')} FCFA ?`,
            [
                { text: "Annuler", style: "cancel" },
                {
                    text: "Confirmer",
                    onPress: () => {
                        Alert.prompt(
                            'Confirmer le remboursement',
                            'Saisissez votre code PIN Mongain pour valider ce remboursement.',
                            [
                                { text: 'Annuler', style: 'cancel' },
                                { text: 'Confirmer', onPress: (pin?: string) => executeRepay(loanId, pin) },
                            ],
                            'secure-text',
                        );
                    }
                }
            ]
        );
    };

    const executeRepay = async (loanId: string, pin?: string) => {
        if (!pin) return Alert.alert("Erreur", "Code PIN requis.");
        setActionLoading(true);
        try {
            const res = await apiRepayCredit(loanId, pin);
            Alert.alert("Succès", "Votre micro-crédit a été intégralement soldé ! ✅");
            await loadData();
        } catch (error: any) {
            Alert.alert('Erreur', error.response?.data?.error || 'Remboursement échoué');
        } finally {
            setActionLoading(false);
        }
    };

    if (loading) {
        return (
            <SafeAreaView style={[styles.container, { alignItems: 'center', justifyContent: 'center' }]}>
                <ActivityIndicator size="large" color={COLORS.primary} />
                <Text style={styles.loaderText}>Analyse de votre profil financier...</Text>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.primary }}>
            {/* Header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16, backgroundColor: COLORS.primary }}>
                <TouchableOpacity style={{ padding: 8, marginLeft: -12 }} onPress={() => router.back()}>
                    <Ionicons name="arrow-back" size={28} color="#fff" />
                </TouchableOpacity>
                <Text style={{ fontSize: 18, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', color: '#fff' }}>Mongain Crédit</Text>
                <View style={{ width: 44 }} />
            </View>

            {/* Sheet Wrapper */}
            <View style={{ flex: 1, backgroundColor: COLORS.background, borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden' }}>
                <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 40) }]}>
                    <View style={styles.header}>
                        <Text style={styles.title}>Fonds immédiats</Text>
                        <Text style={styles.subtitle}>Des liquidités instantanées pour vos projets.</Text>
                    </View>

                    {/* AI Trust Score */}
                    {eligibility && (
                        <View style={styles.card}>
                            <TrustGauge score={eligibility.loyaltyPoints} styles={styles} />
                        </View>
                    )}

                    {/* Active Loan Display */}
                    {activeLoans.length > 0 ? (
                        <View style={styles.activeLoanContainer}>
                            <Text style={styles.sectionTitle}>Crédit en cours</Text>
                            {activeLoans.map((loan) => (
                                <View key={loan.id} style={styles.loanCard}>
                                    <View style={styles.loanRow}>
                                        <Text style={styles.loanLabel}>Montant Principal</Text>
                                        <Text style={styles.loanValue}>{loan.amount.toLocaleString('fr-FR')} FCFA</Text>
                                    </View>
                                    <View style={styles.loanRow}>
                                        <Text style={styles.loanLabel}>Taux ({(loan.interestRate * 100).toFixed(1)}%)</Text>
                                        <Text style={styles.loanInterest}>+{(loan.totalOwed - loan.amount).toLocaleString('fr-FR')} FCFA</Text>
                                    </View>
                                    <View style={[styles.loanRow, styles.loanTotalRow]}>
                                        <Text style={styles.loanTotalLabel}>Total à Rembourser</Text>
                                        <Text style={styles.loanTotalValue}>{loan.totalOwed.toLocaleString('fr-FR')} FCFA</Text>
                                    </View>

                                    <TouchableOpacity
                                        style={styles.repayButton}
                                        onPress={() => handleRepay(loan.id, loan.totalOwed)}
                                        disabled={actionLoading}
                                    >
                                        {actionLoading ? (
                                            <ActivityIndicator color={COLORS.primary} />
                                        ) : (
                                            <Text style={styles.repayButtonText}>Rembourser Maintenant</Text>
                                        )}
                                    </TouchableOpacity>
                                </View>
                            ))}
                        </View>
                    ) : (
                        /* Application Interface */
                        <View style={styles.actionContainer}>
                            {eligibility?.eligible ? (
                                <View style={styles.eligibleCard}>
                                    <Ionicons name="checkmark-circle" size={48} color="#10B981" style={styles.iconCenter} />
                                    <Text style={styles.eligibleTitle}>Vous êtes éligible !</Text>
                                    <Text style={styles.eligibleDesc}>
                                        D'après notre analyse automatisée, vous pouvez emprunter jusqu'à:
                                    </Text>
                                    <Text style={styles.eligibleAmount}>{eligibility.maxAmount.toLocaleString('fr-FR')} FCFA</Text>

                                    <TouchableOpacity
                                        style={styles.applyButton}
                                        onPress={handleApply}
                                        disabled={actionLoading}
                                    >
                                        {actionLoading ? (
                                            <ActivityIndicator color="#fff" />
                                        ) : (
                                            <Text style={styles.applyButtonText}>Débloquer mon crédit</Text>
                                        )}
                                    </TouchableOpacity>
                                </View>
                            ) : (
                                <View style={styles.ineligibleCard}>
                                    <Ionicons name="lock-closed" size={48} color={COLORS.textSecondary} style={styles.iconCenter} />
                                    <Text style={styles.ineligibleTitle}>Accès Restreint</Text>
                                    <Text style={styles.ineligibleDesc}>
                                        Pour débloquer le crédit, développez votre historique.{"\n"}
                                        Utilisez régulièrement Mongain pour les paiements, tontines et transferts professionnels afin d'augmenter votre jauge de confiance.
                                    </Text>
                                </View>
                            )}
                        </View>
                    )}
                </ScrollView>
            </View>
        </SafeAreaView>
    );
}

const getStyles = (COLORS: ReturnType<typeof useAppTheme>) => StyleSheet.create({
    container: { flex: 1, backgroundColor: COLORS.background },
    loaderText: { marginTop: 15, color: COLORS.textSecondary, fontSize: 16, fontFamily: 'Satoshi-SemiBold' },
    content: { padding: 24 },
    header: { marginBottom: 20 },
    title: { fontSize: 28, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', color: COLORS.textPrimary },
    subtitle: { fontSize: 16, color: COLORS.textSecondary, marginTop: 5, fontFamily: 'Satoshi-SemiBold' },
    card: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 20, marginBottom: 24, borderWidth: 1, borderColor: COLORS.border, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
    gaugeContainer: { width: '100%' },
    gaugeLabels: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 10 },
    gaugeTitle: { fontSize: 16, color: COLORS.textPrimary, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' },
    scoreText: { fontSize: 20, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' },
    gaugeBackground: { height: 12, backgroundColor: COLORS.border, borderRadius: 6, overflow: 'hidden' },
    gaugeFill: { height: '100%', borderRadius: 6 },
    gaugeHint: { fontSize: 12, color: COLORS.textSecondary, marginTop: 10 },
    sectionTitle: { fontSize: 18, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', color: COLORS.textPrimary, marginBottom: 15 },
    activeLoanContainer: { marginTop: 10 },
    loanCard: { backgroundColor: COLORS.primary, borderRadius: 16, padding: 20, shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 12, elevation: 4 },
    loanRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
    loanLabel: { color: COLORS.surface, fontSize: 15, opacity: 0.8 },
    loanValue: { color: '#FFFFFF', fontSize: 15, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' },
    loanInterest: { color: '#F87171', fontSize: 15, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' },
    loanTotalRow: { marginTop: 10, paddingTop: 15, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.2)' },
    loanTotalLabel: { color: '#FFFFFF', fontSize: 16, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' },
    loanTotalValue: { color: '#FFFFFF', fontSize: 20, fontFamily: 'Satoshi-SemiBold', fontWeight: '900' },
    repayButton: { backgroundColor: '#FFFFFF', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 20 },
    repayButtonText: { color: COLORS.primary, fontSize: 16, fontFamily: 'Satoshi-SemiBold', fontWeight: '900' },
    actionContainer: { marginTop: 10 },
    eligibleCard: { backgroundColor: COLORS.surface, borderRadius: 16, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
    iconCenter: { marginBottom: 15 },
    eligibleTitle: { fontSize: 22, color: '#10B981', fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', marginBottom: 10 },
    eligibleDesc: { fontSize: 15, color: COLORS.textSecondary, textAlign: 'center', marginBottom: 15, lineHeight: 22 },
    eligibleAmount: { fontSize: 32, color: COLORS.textPrimary, fontFamily: 'Satoshi-SemiBold', fontWeight: '900', marginBottom: 25 },
    applyButton: { backgroundColor: COLORS.primary, borderRadius: 12, paddingVertical: 16, width: '100%', alignItems: 'center' },
    applyButtonText: { color: '#FFFFFF', fontSize: 16, fontFamily: 'Satoshi-SemiBold', fontWeight: '900' },
    ineligibleCard: { backgroundColor: COLORS.background, borderRadius: 16, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: COLORS.border },
    ineligibleTitle: { fontSize: 20, color: COLORS.textSecondary, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', marginBottom: 15 },
    ineligibleDesc: { fontSize: 14, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 22 },
});

