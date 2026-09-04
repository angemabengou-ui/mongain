import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { apiGetMyInvoices, apiPayInvoice, apiRejectInvoice } from '../services/api';

export function InvoiceApprover() {
    const { token } = useAuth();
    const [invoices, setInvoices] = useState<any[]>([]);
    const [activeInvoice, setActiveInvoice] = useState<any | null>(null);
    const [pin, setPin] = useState('');
    const [loading, setLoading] = useState(false);
    const [fetching, setFetching] = useState(false);

    // Initial check when app opens / auth succeeds
    useEffect(() => {
        if (!token) return;

        let interval: ReturnType<typeof setInterval>;

        const fetchInvoices = async () => {
            try {
                const res = await apiGetMyInvoices();
                if (res.success && res.invoices.length > 0) {
                    setInvoices(res.invoices);
                    // Mise à jour fonctionnelle : cet effet ne dépend que de `token` (il ne
                    // doit tourner qu'une fois par session, pas se reconstruire à chaque
                    // frappe dans le champ PIN) — `activeInvoice` lu directement ici restait
                    // donc figé sur sa valeur `null` initiale dans la fermeture de ce
                    // setInterval, pour toujours. Résultat : CHAQUE poll (10s) réécrasait
                    // l'invoice affichée par `res.invoices[0]`, même une facture déjà en cours
                    // de saisie de PIN par l'utilisateur — une nouvelle facture plus récente
                    // arrivant entre-temps (triée par createdAt desc côté serveur) remplaçait
                    // silencieusement celle affichée sous les doigts de l'utilisateur, qui
                    // pouvait alors valider par inadvertance un paiement différent de celui
                    // qu'il pensait autoriser.
                    setActiveInvoice((prev: any | null) => prev ?? res.invoices[0]);
                } else {
                    setInvoices([]);
                    setActiveInvoice(null);
                }
            } catch (e) {
                // Ignore silent errors
            }
        };

        fetchInvoices();

        // Poll every 10 seconds for new checkouts
        interval = setInterval(fetchInvoices, 10000);
        return () => clearInterval(interval);
    }, [token]);

    const handleAccept = async () => {
        if (pin.length !== 4) {
            Alert.alert('Erreur', 'Veuillez saisir votre PIN à 4 chiffres.');
            return;
        }
        setLoading(true);
        try {
            await apiPayInvoice(activeInvoice.id, pin);
            Alert.alert('Succès', 'Paiement autorisé et effectué avec succès !');
            setPin('');
            setActiveInvoice(null);
            // Will let the interval fetch the next invoice if any, or clear it out
        } catch (e: any) {
            Alert.alert('Erreur', e.message || 'Une erreur est survenue');
        } finally {
            setLoading(false);
        }
    };

    const handleReject = async () => {
        setLoading(true);
        try {
            await apiRejectInvoice(activeInvoice.id);
            Alert.alert('Rejeté', 'La transaction a été annulée.');
            setPin('');
            setActiveInvoice(null);
        } catch (e: any) {
            Alert.alert('Erreur', e.message || 'Une erreur est survenue');
        } finally {
            setLoading(false);
        }
    };

    if (!activeInvoice) return null;

    return (
        <Modal transparent animationType="slide" visible={!!activeInvoice}>
            <View style={styles.overlay}>
                <View style={styles.modalCard}>
                    <View style={styles.iconContainer}>
                        <Text style={styles.icon}>🔒</Text>
                    </View>
                    <Text style={styles.title}>Autorisation 3D-Secure</Text>
                    <Text style={styles.subtitle}>
                        {activeInvoice.merchant?.name || 'Un marchand'} demande à prélever via Mongain Connect.
                    </Text>

                    <View style={styles.detailsBox}>
                        <Text style={styles.label}>Montant</Text>
                        <Text style={styles.amount}>{activeInvoice.amount} FCFA</Text>
                        {!!activeInvoice.description && (
                            <Text style={styles.description}>{activeInvoice.description}</Text>
                        )}
                    </View>

                    <Text style={styles.pinLabel}>Confirmez avec votre code PIN</Text>
                    <TextInput
                        style={styles.pinInput}
                        keyboardType="number-pad"
                        secureTextEntry
                        maxLength={4}
                        value={pin}
                        onChangeText={setPin}
                        placeholder="••••"
                        placeholderTextColor="#9ca3af"
                    />

                    {loading ? (
                        <ActivityIndicator size="large" color="#059669" style={{ marginVertical: 20 }} />
                    ) : (
                        <View style={styles.buttons}>
                            <TouchableOpacity style={[styles.btn, styles.btnReject]} onPress={handleReject}>
                                <Text style={styles.btnTextReject}>Refuser</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.btn, styles.btnAccept]} onPress={handleAccept}>
                                <Text style={styles.btnTextAccept}>Autoriser</Text>
                            </TouchableOpacity>
                        </View>
                    )}
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.6)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    modalCard: {
        backgroundColor: '#1E293B',
        borderRadius: 24,
        padding: 24,
        width: '100%',
        maxWidth: 400,
        alignItems: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.3,
        shadowRadius: 20,
        elevation: 10,
    },
    iconContainer: {
        width: 64,
        height: 64,
        borderRadius: 32,
        backgroundColor: 'rgba(99, 102, 241, 0.1)',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 16,
    },
    icon: {
        fontSize: 32,
    },
    title: {
        color: '#F8FAFC',
        fontSize: 22,
        fontWeight: '700',
        marginBottom: 8,
        textAlign: 'center',
    },
    subtitle: {
        color: '#94A3B8',
        fontSize: 15,
        textAlign: 'center',
        marginBottom: 24,
        lineHeight: 22,
    },
    detailsBox: {
        backgroundColor: '#0F172A',
        width: '100%',
        padding: 16,
        borderRadius: 16,
        marginBottom: 24,
        alignItems: 'center',
    },
    label: {
        color: '#64748B',
        fontSize: 13,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: 4,
    },
    amount: {
        color: '#10B981',
        fontSize: 28,
        fontWeight: '800',
    },
    description: {
        color: '#64748B',
        fontSize: 14,
        marginTop: 8,
        textAlign: 'center',
    },
    pinLabel: {
        color: '#E2E8F0',
        fontSize: 15,
        fontWeight: '600',
        marginBottom: 12,
        alignSelf: 'flex-start',
    },
    pinInput: {
        backgroundColor: '#0F172A',
        color: '#F8FAFC',
        width: '100%',
        padding: 16,
        borderRadius: 12,
        fontSize: 24,
        textAlign: 'center',
        letterSpacing: 10,
        marginBottom: 24,
        fontWeight: '700',
    },
    buttons: {
        flexDirection: 'row',
        gap: 12,
        width: '100%',
    },
    btn: {
        flex: 1,
        paddingVertical: 16,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
    btnReject: {
        backgroundColor: 'rgba(239, 68, 68, 0.1)',
    },
    btnTextReject: {
        color: '#EF4444',
        fontSize: 16,
        fontWeight: '700',
    },
    btnAccept: {
        backgroundColor: '#059669',
    },
    btnTextAccept: {
        color: '#FFFFFF',
        fontSize: 16,
        fontWeight: '700',
    },
});
