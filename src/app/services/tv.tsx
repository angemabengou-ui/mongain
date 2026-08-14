import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Platform,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { useAppTheme } from '../../constants/theme';
import { useAuth } from '../../context/AuthContext';

export default function TvScreen() {
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);
    const router = useRouter();
    const { user } = useAuth();

    const [account, setAccount] = useState('');
    const [amount, setAmount] = useState('');
    const [pin, setPin] = useState('');
    const [showPin, setShowPin] = useState(false);
    const [loading, setLoading] = useState(false);

    const handlePayment = async () => {
        if (!account || account.length < 5) {
            Alert.alert("Erreur", "Veuillez entrer un numéro d'abonné valide.");
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

        // --- PRODUCTION GUARD ---
        Alert.alert(
            "Service Indisponible",
            "L'intégration officielle avec Canal+ est en cours de configuration. Le service sera bientôt actif !"
        );
        return;
        // ------------------------
    };

    return (
        <SafeAreaView style={styles.safeArea}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.flex}>
                <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
                    <View style={styles.header}>
                        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                            <Ionicons name="arrow-back" size={28} color={COLORS.textPrimary} />
                        </TouchableOpacity>
                        <Text style={styles.headerTitle}>Abonnement TV</Text>
                    </View>

                    <View style={styles.card}>
                        <View style={{ alignItems: 'center', marginBottom: 24 }}>
                            <View style={[styles.iconWrap, { backgroundColor: '#3b82f615' }]}>
                                <Ionicons name="tv" size={40} color="#3b82f6" />
                            </View>
                            <Text style={styles.title}>Canal+</Text>
                            <Text style={styles.subtitle}>Solde disponible: <Text style={{ fontWeight: '700' }}>{(user?.wallet?.balance || 0).toLocaleString('fr-FR')} FCFA</Text></Text>
                        </View>

                        <Text style={styles.label}>Numéro d'Abonné</Text>
                        <View style={styles.inputContainer}>
                            <MaterialCommunityIcons name="smart-card-outline" size={20} color={COLORS.textSecondary} style={styles.inputIcon} />
                            <TextInput
                                style={styles.input}
                                placeholder="ex: 123456789"
                                keyboardType="number-pad"
                                value={account}
                                onChangeText={setAccount}
                                placeholderTextColor={COLORS.textSecondary}
                            />
                        </View>

                        <Text style={styles.label}>Montant (FCFA)</Text>
                        <View style={styles.inputContainer}>
                            <Ionicons name="cash-outline" size={20} color={COLORS.textSecondary} style={styles.inputIcon} />
                            <TextInput
                                style={styles.input}
                                placeholder="ex: 5000"
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

                        <TouchableOpacity style={[styles.btn, { backgroundColor: '#3b82f6' }]} onPress={handlePayment} disabled={loading}>
                            {loading ? (
                                <ActivityIndicator color="#fff" />
                            ) : (
                                <Text style={styles.btnText}>Renouveler l'abonnement</Text>
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

    label: { fontSize: 14, fontWeight: '600', color: COLORS.textPrimary, marginBottom: 8 },
    inputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: 16, paddingHorizontal: 16, height: 56, marginBottom: 24, borderWidth: 1, borderColor: COLORS.border },
    inputIcon: { marginRight: 12 },
    input: { flex: 1, fontSize: 16, color: COLORS.textPrimary, fontWeight: '600' },
    eyeBtn: { padding: 8 },
    btn: { height: 56, borderRadius: 16, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 4 },
    btnText: { color: '#fff', fontSize: 16, fontWeight: '700' }
});
