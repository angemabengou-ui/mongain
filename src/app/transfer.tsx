import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import ContactPickerModal from '../components/ui/ContactPickerModal';
import { useAppTheme } from '../constants/theme';
import { apiLookupUser } from '../services/api';
import type { MongainContact } from '../services/contacts';

export default function TransferScreen() {
    const COLORS = useAppTheme();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const [phone, setPhone] = useState('');
    const [recipient, setRecipient] = useState<{ id: string; name: string; phone: string; role?: string } | null>(null);
    const [lookupError, setLookupError] = useState('');
    const [isLooking, setIsLooking] = useState(false);

    // Contact Picker State
    const [contactsModalVisible, setContactsModalVisible] = useState(false);

    // Animation de la carte destinataire
    const cardAnim = useRef(new Animated.Value(0)).current;
    // Voir handleContactPicked : évite que l'effet de lookup débounce ci-dessous n'efface le
    // destinataire qu'on vient tout juste de choisir via le sélecteur de contacts.
    const skipNextPhoneEffect = useRef(false);

    useEffect(() => {
        Animated.timing(cardAnim, {
            toValue: recipient ? 1 : 0,
            duration: 250,
            useNativeDriver: true,
        }).start();
    }, [recipient]);

    // Lookup automatique quand le numéro a au moins 8 chiffres
    useEffect(() => {
        // handleContactPicked vide le champ manuel PAR PROPRETÉ après avoir choisi un contact
        // (déjà confirmé côté serveur) — sans ce garde-fou, ce simple changement de `phone`
        // relançait cet effet, qui efface `recipient` en tout premier (voir juste plus bas) et
        // écrasait silencieusement le contact qu'on venait tout juste de sélectionner.
        if (skipNextPhoneEffect.current) {
            skipNextPhoneEffect.current = false;
            return;
        }

        const cleaned = phone.replace(/\s/g, '');
        // Effacé de façon SYNCHRONE dès que le numéro change (pas seulement à l'intérieur du
        // setTimeout ci-dessous) : sinon la carte destinataire ET le bouton "Continuer" restent
        // actifs sur l'ANCIEN destinataire pendant les 600ms du debounce — assez pour valider un
        // numéro A, corriger un chiffre, puis appuyer sur Continuer avant que le nouveau lookup
        // ne parte, ouvrant transfer-confirm avec le destinataire A alors que le champ affiche B.
        setRecipient(null);
        setLookupError('');

        if (cleaned.length < 8) {
            return;
        }

        const timer = setTimeout(async () => {
            setIsLooking(true);
            try {
                const fullPhone = cleaned.startsWith('+') ? cleaned : `+241${cleaned}`;
                const found = await apiLookupUser(fullPhone);
                setRecipient(found);
            } catch (e: any) {
                setLookupError(e.message);
            } finally {
                setIsLooking(false);
            }
        }, 600); // debounce 600ms

        return () => clearTimeout(timer);
    }, [phone]);

    const handleContinue = () => {
        if (!recipient) return;
        router.push({
            pathname: '/transfer-confirm',
            params: { receiverPhone: recipient.phone, receiverName: recipient.name, isMerchant: recipient.role === 'MERCHANT' ? 'true' : 'false' },
        });
    };

    // Le contact choisi est DÉJÀ un compte Mongain confirmé (ContactPickerModal ne montre
    // que les correspondances côté serveur) — on définit directement le destinataire, sans
    // repasser par le lookup débounce ci-dessus (qui reste utile pour la saisie manuelle).
    const handleContactPicked = (contact: MongainContact) => {
        setContactsModalVisible(false);
        // Ne pose le garde-fou que si `setPhone('')` va réellement changer `phone` (et donc
        // relancer l'effet de lookup) — sinon le flag resterait armé sans jamais être consommé,
        // et sauterait le PROCHAIN vrai changement de numéro par erreur.
        if (phone !== '') skipNextPhoneEffect.current = true;
        setPhone('');
        setLookupError('');
        setRecipient({ id: contact.id, name: contact.name, phone: contact.phone, role: contact.role });
    };

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: COLORS.background }]}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>

                <View style={styles.header}>
                    <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                        <Ionicons name="arrow-back" size={28} color={COLORS.textPrimary} />
                    </TouchableOpacity>
                    <Text style={[styles.headerTitle, { color: COLORS.textPrimary }]}>Envoyer de l'argent</Text>
                    <View style={{ width: 44 }} />
                </View>

                <ScrollView contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 60) }]} keyboardShouldPersistTaps="handled">

                    {/* Grille d'Actions Massives */}
                    <View style={styles.actionGrid}>
                        <TouchableOpacity style={[styles.actionCard, { backgroundColor: COLORS.surface, borderColor: COLORS.border }]} onPress={() => router.push('/qr')}>
                            <View style={[styles.actionIconWrap, { backgroundColor: '#3B82F615' }]}>
                                <Ionicons name="qr-code" size={28} color="#3B82F6" />
                            </View>
                            <Text style={[styles.actionCardTitle, { color: COLORS.textPrimary }]}>Scanner QR</Text>
                            <Text style={styles.actionCardSub}>Instantané</Text>
                        </TouchableOpacity>

                        <TouchableOpacity style={[styles.actionCard, { backgroundColor: COLORS.surface, borderColor: COLORS.border }]} onPress={() => setContactsModalVisible(true)}>
                            <View style={[styles.actionIconWrap, { backgroundColor: '#8B5CF615' }]}>
                                <Ionicons name="people" size={28} color="#8B5CF6" />
                            </View>
                            <Text style={[styles.actionCardTitle, { color: COLORS.textPrimary }]}>Mes Contacts</Text>
                            <Text style={styles.actionCardSub}>Répertoire</Text>
                        </TouchableOpacity>
                    </View>

                    <Text style={styles.sectionTitle}>Saisie Manuelle</Text>

                    {/* Saisie manuelle Modernisée */}
                    <View style={[styles.inputContainer, { backgroundColor: COLORS.surface, borderColor: COLORS.border }, (isLooking || recipient) ? { borderColor: COLORS.primary } : null]}>
                        <Text style={[styles.prefix, { color: COLORS.textPrimary }]}>+241</Text>
                        <TextInput
                            style={[styles.input, { color: COLORS.textPrimary }]}
                            placeholder="Ex: 077..."
                            keyboardType="phone-pad"
                            placeholderTextColor={COLORS.textSecondary}
                            value={phone}
                            onChangeText={setPhone}
                        />
                        {isLooking ? (
                            <ActivityIndicator size="small" color={COLORS.primary} style={{ padding: 8 }} />
                        ) : phone.length > 0 ? (
                            <TouchableOpacity onPress={() => { setPhone(''); setRecipient(null); setLookupError(''); }} style={{ padding: 8 }}>
                                <Ionicons name="close-circle" size={22} color={COLORS.textSecondary} />
                            </TouchableOpacity>
                        ) : null}
                    </View>

                    {/* Ligne d'erreur */}
                    {lookupError ? (
                        <View style={styles.errorBox}>
                            <Ionicons name="alert-circle" size={20} color="#E11D48" />
                            <Text style={styles.errorText}>{lookupError}</Text>
                        </View>
                    ) : null}

                    {/* Carte Destinataire Validé */}
                    {recipient && (
                        <Animated.View style={[styles.recipientCard, {
                            borderColor: COLORS.primary + '40',
                            backgroundColor: COLORS.primary + '05',
                            opacity: cardAnim,
                            transform: [{ translateY: cardAnim.interpolate({ inputRange: [0, 1], outputRange: [20, 0] }) }]
                        }]}>
                            <View style={styles.recipientHeader}>
                                <View style={[styles.recipientAvatar, { backgroundColor: COLORS.primary + '20' }]}>
                                    <Text style={[styles.recipientInitial, { color: COLORS.primary }]}>
                                        {recipient.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                                    </Text>
                                </View>
                                <View style={styles.recipientInfo}>
                                    <Text style={[styles.recipientName, { color: COLORS.textPrimary }]}>{recipient.name}</Text>
                                    <Text style={styles.recipientPhone}>{recipient.phone}</Text>
                                </View>
                                <View style={[styles.checkBadge, { backgroundColor: COLORS.primary }]}>
                                    <Ionicons name="checkmark" size={16} color="#fff" />
                                </View>
                            </View>
                            {recipient.role === 'MERCHANT' && (
                                <View style={styles.merchantBadge}>
                                    <Ionicons name="business" size={14} color="#D97706" />
                                    <Text style={styles.merchantText}>Compte Marchand</Text>
                                </View>
                            )}
                        </Animated.View>
                    )}

                    <View style={{ flex: 1 }} />

                    {/* Bouton Continuer */}
                    <TouchableOpacity
                        style={[styles.sendButton, !recipient && { backgroundColor: COLORS.surface, borderColor: COLORS.border, borderWidth: 1, shadowOpacity: 0 }, recipient && { backgroundColor: COLORS.primary }]}
                        onPress={handleContinue}
                        disabled={!recipient}
                    >
                        <Text style={[styles.sendButtonText, !recipient ? { color: COLORS.textSecondary } : { color: '#ffffff' }]}>Continuer vers le montant</Text>
                        {recipient && <Ionicons name="arrow-forward" size={20} color="#fff" style={{ marginLeft: 8 }} />}
                    </TouchableOpacity>

                </ScrollView>

                <ContactPickerModal
                    visible={contactsModalVisible}
                    onClose={() => setContactsModalVisible(false)}
                    onSelect={handleContactPicked}
                    colors={COLORS}
                />

                {insets.bottom > 0 && <View style={{ height: Math.max(insets.bottom, 20) }} />}
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: { flex: 1 },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, paddingVertical: 16,
    },
    backButton: { padding: 8, marginLeft: -12 },
    headerTitle: { fontSize: 20, fontWeight: '800' },
    content: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 12, paddingBottom: 60 },

    actionGrid: { flexDirection: 'row', gap: 16, marginBottom: 32 },
    actionCard: { flex: 1, borderRadius: 20, padding: 20, alignItems: 'center', borderWidth: 1 },
    actionIconWrap: { width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
    actionCardTitle: { fontSize: 16, fontWeight: '800', marginBottom: 4 },
    actionCardSub: { fontSize: 13, color: '#94a3b8', fontWeight: '500' },

    sectionTitle: { fontSize: 14, fontWeight: '800', color: '#94a3b8', textTransform: 'uppercase', marginBottom: 12, marginLeft: 4, letterSpacing: 1 },

    inputContainer: {
        flexDirection: 'row', alignItems: 'center',
        borderRadius: 16, paddingHorizontal: 16, height: 60, marginBottom: 16,
        borderWidth: 1.5,
    },
    prefix: { fontSize: 17, fontWeight: '800', marginRight: 12, paddingRight: 12, borderRightWidth: 1, borderRightColor: '#e2e8f0' },
    input: { flex: 1, fontSize: 18, fontWeight: '700', height: '100%', letterSpacing: 1 },

    errorBox: {
        flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEE2E2',
        borderRadius: 12, padding: 16, marginVertical: 8, gap: 10,
    },
    errorText: { color: '#E11D48', fontSize: 14, flex: 1, fontWeight: '500', lineHeight: 20 },

    recipientCard: {
        borderRadius: 20, padding: 20, marginTop: 12,
        borderWidth: 1,
    },
    recipientHeader: { flexDirection: 'row', alignItems: 'center', gap: 16 },
    recipientAvatar: {
        width: 52, height: 52, borderRadius: 26,
        justifyContent: 'center', alignItems: 'center',
    },
    recipientInitial: { fontSize: 20, fontWeight: '800' },
    recipientInfo: { flex: 1 },
    recipientName: { fontSize: 18, fontWeight: '800', marginBottom: 4 },
    recipientPhone: { fontSize: 14, color: '#94a3b8', fontWeight: '500' },
    checkBadge: { width: 28, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
    merchantBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF3C7', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, alignSelf: 'flex-start', marginTop: 16, gap: 6 },
    merchantText: { color: '#D97706', fontSize: 12, fontWeight: '700' },

    sendButton: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        height: 60, borderRadius: 16, marginTop: 32,
    },
    sendButtonText: { fontSize: 17, fontWeight: '800' },
});
