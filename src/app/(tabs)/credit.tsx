import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { apiApplyCredit, apiGetActiveLoans, apiGetCreditEligibility, apiRepayCredit } from '../../services/api';

const TrustGauge = ({ score }: { score: number }) => {
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
                    onPress: async () => {
                        setActionLoading(true);
                        try {
                            const res = await apiApplyCredit(eligibility.maxAmount);
                            Alert.alert("Succès", "Les fonds ont été virés sur votre portefeuille ! 🎉");
                            await loadData();
                        } catch (error: any) {
                            Alert.alert('Erreur', error.response?.data?.error || 'Opération échouée');
                        } finally {
                            setActionLoading(false);
                        }
                    }
                }
            ]
        );
    };

    const handleRepay = async (loanId: string, amountOwed: number) => {
        Alert.alert(
            "Remboursement",
            `Voulez-vous rembourser le solde total de ${amountOwed.toLocaleString('fr-FR')} FCFA ?`,
            [
                { text: "Annuler", style: "cancel" },
                {
                    text: "Confirmer",
                    onPress: async () => {
                        setActionLoading(true);
                        try {
                            const res = await apiRepayCredit(loanId);
                            Alert.alert("Succès", "Votre micro-crédit a été intégralement soldé ! ✅");
                            await loadData();
                        } catch (error: any) {
                            Alert.alert('Erreur', error.response?.data?.error || 'Remboursement échoué');
                        } finally {
                            setActionLoading(false);
                        }
                    }
                }
            ]
        );
    };

    if (loading) {
        return (
            <View style={styles.loaderContainer}>
                <ActivityIndicator size="large" color="#1E3A8A" />
                <Text style={styles.loaderText}>Analyse de votre profil financier...</Text>
            </View>
        );
    }

    return (
        <ScrollView style={styles.container} contentContainerStyle={styles.content}>
            <View style={styles.header}>
                <Text style={styles.title}>Mongain Crédit</Text>
                <Text style={styles.subtitle}>Des fonds instantanés pour vos projets.</Text>
            </View>

            {/* AI Trust Score */}
            {eligibility && (
                <View style={styles.card}>
                    <TrustGauge score={eligibility.loyaltyPoints} />
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
                                    <ActivityIndicator color="#fff" />
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
                            <Ionicons name="checkmark-circle" size={48} color="#2A9D8F" style={styles.iconCenter} />
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
                            <Ionicons name="lock-closed" size={48} color="#9CA3AF" style={styles.iconCenter} />
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
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#F3F4F6',
    },
    loaderContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#F3F4F6',
    },
    loaderText: {
        marginTop: 15,
        color: '#6B7280',
        fontSize: 16,
        fontFamily: 'Inter-Medium',
    },
    content: {
        padding: 20,
        paddingBottom: 40,
    },
    header: {
        marginTop: 40,
        marginBottom: 20,
    },
    title: {
        fontSize: 28,
        fontWeight: 'bold',
        color: '#111827',
        fontFamily: 'Inter-Bold',
    },
    subtitle: {
        fontSize: 16,
        color: '#6B7280',
        marginTop: 5,
        fontFamily: 'Inter-Regular',
    },
    card: {
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 20,
        marginBottom: 24,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
        elevation: 2,
    },
    gaugeContainer: {
        width: '100%',
    },
    gaugeLabels: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        marginBottom: 10,
    },
    gaugeTitle: {
        fontSize: 16,
        color: '#374151',
        fontFamily: 'Inter-Medium',
    },
    scoreText: {
        fontSize: 20,
        fontWeight: 'bold',
        fontFamily: 'Inter-Bold',
    },
    gaugeBackground: {
        height: 12,
        backgroundColor: '#E5E7EB',
        borderRadius: 6,
        overflow: 'hidden',
    },
    gaugeFill: {
        height: '100%',
        borderRadius: 6,
    },
    gaugeHint: {
        fontSize: 12,
        color: '#9CA3AF',
        marginTop: 10,
        fontFamily: 'Inter-Regular',
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: '#111827',
        marginBottom: 15,
        fontFamily: 'Inter-SemiBold',
    },
    activeLoanContainer: {
        marginTop: 10,
    },
    loanCard: {
        backgroundColor: '#1E3A8A',
        borderRadius: 16,
        padding: 20,
        shadowColor: '#1E3A8A',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.2,
        shadowRadius: 12,
        elevation: 4,
    },
    loanRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 10,
    },
    loanLabel: {
        color: '#93C5FD',
        fontSize: 15,
        fontFamily: 'Inter-Regular',
    },
    loanValue: {
        color: '#FFFFFF',
        fontSize: 15,
        fontFamily: 'Inter-Medium',
    },
    loanInterest: {
        color: '#F87171',
        fontSize: 15,
        fontFamily: 'Inter-Medium',
    },
    loanTotalRow: {
        marginTop: 10,
        paddingTop: 15,
        borderTopWidth: 1,
        borderTopColor: '#3B82F6',
    },
    loanTotalLabel: {
        color: '#FFFFFF',
        fontSize: 16,
        fontFamily: 'Inter-SemiBold',
    },
    loanTotalValue: {
        color: '#FFFFFF',
        fontSize: 20,
        fontWeight: 'bold',
        fontFamily: 'Inter-Bold',
    },
    repayButton: {
        backgroundColor: '#FFFFFF',
        borderRadius: 12,
        paddingVertical: 14,
        alignItems: 'center',
        marginTop: 20,
    },
    repayButtonText: {
        color: '#1E3A8A',
        fontSize: 16,
        fontWeight: '600',
        fontFamily: 'Inter-SemiBold',
    },
    actionContainer: {
        marginTop: 10,
    },
    eligibleCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: 24,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 8,
        elevation: 2,
    },
    iconCenter: {
        marginBottom: 15,
    },
    eligibleTitle: {
        fontSize: 22,
        color: '#2A9D8F',
        fontWeight: 'bold',
        marginBottom: 10,
        fontFamily: 'Inter-Bold',
    },
    eligibleDesc: {
        fontSize: 15,
        color: '#4B5563',
        textAlign: 'center',
        marginBottom: 15,
        lineHeight: 22,
        fontFamily: 'Inter-Regular',
    },
    eligibleAmount: {
        fontSize: 32,
        color: '#111827',
        fontWeight: 'bold',
        marginBottom: 25,
        fontFamily: 'Inter-Bold',
    },
    applyButton: {
        backgroundColor: '#1E3A8A',
        borderRadius: 12,
        paddingVertical: 16,
        width: '100%',
        alignItems: 'center',
    },
    applyButtonText: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '600',
        fontFamily: 'Inter-SemiBold',
    },
    ineligibleCard: {
        backgroundColor: '#F9FAFB',
        borderRadius: 16,
        padding: 24,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#E5E7EB',
    },
    ineligibleTitle: {
        fontSize: 20,
        color: '#4B5563',
        fontWeight: 'bold',
        marginBottom: 15,
        fontFamily: 'Inter-SemiBold',
    },
    ineligibleDesc: {
        fontSize: 14,
        color: '#6B7280',
        textAlign: 'center',
        lineHeight: 22,
        fontFamily: 'Inter-Regular',
    },
});
