import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppTheme } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';
import { apiGetBalance } from '../../services/api';

export default function AirtimeScreen() {
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);
    const router = useRouter();
    const { user } = useAuth();

    const [network, setNetwork] = useState<'AIRTEL' | 'MOOV'>('AIRTEL');
    const [phone, setPhone] = useState(user?.phone || '');
    const [amount, setAmount] = useState('');
    const [pin, setPin] = useState('');
    const [showPin, setShowPin] = useState(false);
    const [loading, setLoading] = useState(false);
    const [successData, setSuccessData] = useState<any>(null);

    const [balance, setBalance] = useState(user?.wallet?.balance || 0);
    useFocusEffect(
        useCallback(() => {
            apiGetBalance().then(res => {
                if (res && res.balance !== undefined) setBalance(res.balance);
            }).catch(console.error);
        }, [])
    );

    const handleTopUp = async () => {
        if (!phone || phone.length < 8) {
            Alert.alert("Erreur", "Veuillez entrer un numéro de téléphone valide.");
            return;
        }

        const amt = parseFloat(amount.replace(/\s/g, ''));
        if (isNaN(amt) || amt <= 0) {
            Alert.alert("Erreur", "Veuillez entrer un montant valide.");
            return;
        }

        if (pin.length !== 4) {
            Alert.alert("Erreur", "Code PIN requis.");
            return;
        }

    };

    if (successData) {
        return (
            <SafeAreaView style={[styles.safeArea, { justifyContent: 'center', alignItems: 'center', padding: 32 }]}>
                <View style={[styles.iconWrap, { backgroundColor: '#10b98115', padding: 24, borderRadius: 50 }]}>
                    <Ionicons name="checkmark-circle" size={80} color="#10b981" />
                </View>
                <Text style={[styles.title, { marginBottom: 16 }]}>Recharge Réussie !</Text>

                <View style={styles.receiptCard}>
                    <View style={{ alignItems: 'center', marginBottom: 16 }}>
                        <Ionicons name={network === 'AIRTEL' ? 'cellular' : 'radio'} size={32} color={network === 'AIRTEL' ? '#ef4444' : '#0284c7'} />
                        <Text style={[styles.receiptLabel, { marginTop: 8, color: '#fff', fontSize: 16, fontWeight: '700' }]}>{network} Gabon</Text>
                    </View>
                    <View style={styles.divider} />

                    <Text style={styles.receiptLabel}>Montant Rechargé</Text>
                    <Text style={styles.receiptValue}>{parseFloat(amount).toLocaleString('fr-FR')} FCFA</Text>

                    <Text style={styles.receiptLabel}>Numéro Bénéficiaire</Text>
                    <Text style={styles.receiptValue}>{phone}</Text>

                    <Text style={styles.receiptLabel}>Référence</Text>
                    <Text style={[styles.receiptValue, { fontSize: 13, color: '#94a3b8' }]}>{successData.reference}</Text>
                </View>

                <TouchableOpacity style={[styles.btn, { width: '100%', marginTop: 32 }]} onPress={() => router.replace('/')}>
                    <Text style={styles.btnText}>Retour à l'accueil</Text>
                </TouchableOpacity>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.safeArea}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
                <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
                    <View style={styles.header}>
                        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                            <Ionicons name="arrow-back" size={28} color={COLORS.textPrimary} />
                        </TouchableOpacity>
                        <Text style={styles.headerTitle}>Crédit d'appel</Text>
                    </View>

                    <View style={styles.card}>
                        <View style={{ alignItems: 'center', marginBottom: 24 }}>
                            <View style={[styles.iconWrap, { backgroundColor: '#d946ef15' }]}>
                                <Ionicons name="phone-portrait" size={40} color="#d946ef" />
                            </View>
                            <Text style={styles.title}>Recharge Mobile</Text>
                            <Text style={styles.subtitle}>Solde disponible: <Text style={{ fontWeight: '700' }}>{balance.toLocaleString('fr-FR')} FCFA</Text></Text>
                        </View>

                        <Text style={styles.label}>Choisir l'opérateur</Text>
                        <View style={styles.networkSelector}>
                            <TouchableOpacity
                                style={[styles.networkBtn, network === 'AIRTEL' && styles.networkBtnActiveAirtel]}
                                onPress={() => setNetwork('AIRTEL')}>
                                <Text style={[styles.networkText, network === 'AIRTEL' && { color: '#fff' }]}>AIRTEL</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.networkBtn, network === 'MOOV' && styles.networkBtnActiveMoov]}
                                onPress={() => setNetwork('MOOV')}>
                                <Text style={[styles.networkText, network === 'MOOV' && { color: '#fff' }]}>MOOV</Text>
                            </TouchableOpacity>
                        </View>

                        <Text style={styles.label}>Numéro de téléphone</Text>
                        <View style={styles.inputContainer}>
                            <Ionicons name="call-outline" size={20} color={COLORS.textSecondary} style={styles.inputIcon} />
                            <TextInput
                                style={styles.input}
                                placeholder="+241 00 00 00 00"
                                keyboardType="phone-pad"
                                value={phone}
                                onChangeText={setPhone}
                                placeholderTextColor={COLORS.textSecondary}
                            />
                        </View>

                        <Text style={styles.label}>Montant (FCFA)</Text>
                        <View style={styles.inputContainer}>
                            <Ionicons name="cash-outline" size={20} color={COLORS.textSecondary} style={styles.inputIcon} />
                            <TextInput
                                style={styles.input}
                                placeholder="0"
                                keyboardType="number-pad"
                                value={amount}
                                onChangeText={setAmount}
                                placeholderTextColor={COLORS.textSecondary}
                            />
                        </View>

                        <Text style={styles.label}>Code PIN Mongain</Text>
                        <View style={styles.inputContainer}>
                            <Ionicons name="lock-closed-outline" size={20} color={COLORS.textSecondary} style={styles.inputIcon} />
                            <TextInput
                                style={styles.input}
                                placeholder="••••"
                                keyboardType="number-pad"
                                secureTextEntry={!showPin}
                                maxLength={4}
                                value={pin}
                                onChangeText={setPin}
                                placeholderTextColor={COLORS.textSecondary}
                            />
                            <TouchableOpacity onPress={() => setShowPin(!showPin)} style={styles.eyeBtn}>
                                <Ionicons name={showPin ? 'eye-off-outline' : 'eye-outline'} size={20} color={COLORS.textSecondary} />
                            </TouchableOpacity>
                        </View>

                        <TouchableOpacity style={[styles.btn, { backgroundColor: '#d946ef' }]} onPress={handleTopUp} disabled={loading}>
                            {loading ? (
                                <ActivityIndicator color="#fff" />
                            ) : (
                                <Text style={styles.btnText}>Acheter du crédit</Text>
                            )}
                        </TouchableOpacity>
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const getStyles = (COLORS: ReturnType<typeof useAppTheme>) => StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: COLORS.background },
    flex: { flex: 1 },
    scroll: { flexGrow: 1, padding: 24 },
    header: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
    backButton: { marginRight: 16 },
    headerTitle: { fontSize: 24, fontWeight: '800', color: COLORS.textPrimary },
    card: { backgroundColor: COLORS.surface, borderRadius: 24, padding: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 12, elevation: 4 },
    iconWrap: { backgroundColor: COLORS.primary + '15', padding: 16, borderRadius: 50, marginBottom: 12 },
    title: { fontSize: 22, fontWeight: '800', color: COLORS.textPrimary },
    subtitle: { fontSize: 14, color: COLORS.textSecondary, marginTop: 4 },

    networkSelector: { flexDirection: 'row', gap: 12, marginBottom: 24 },
    networkBtn: { flex: 1, height: 48, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, justifyContent: 'center', alignItems: 'center' },
    networkBtnActiveAirtel: { backgroundColor: '#ef4444', borderColor: '#ef4444' },
    networkBtnActiveMoov: { backgroundColor: '#0284c7', borderColor: '#0284c7' },
    networkText: { fontSize: 14, fontWeight: '700', color: COLORS.textSecondary },

    label: { fontSize: 14, fontWeight: '600', color: COLORS.textPrimary, marginBottom: 8 },
    inputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: 16, paddingHorizontal: 16, height: 56, marginBottom: 24, borderWidth: 1, borderColor: COLORS.border },
    inputIcon: { marginRight: 12 },
    input: { flex: 1, fontSize: 16, color: COLORS.textPrimary, fontWeight: '600' },
    eyeBtn: { padding: 8 },
    btn: { height: 56, borderRadius: 16, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 4 },
    btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

    receiptCard: { backgroundColor: '#1E293B', width: '100%', borderRadius: 20, padding: 24 },
    receiptLabel: { fontSize: 13, color: '#94A3B8', marginBottom: 4 },
    receiptValue: { fontSize: 16, fontWeight: '700', color: '#FFF', marginBottom: 16 },
    divider: { height: 1, backgroundColor: '#334155', marginVertical: 16 }
});
