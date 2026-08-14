import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    KeyboardAvoidingView,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppTheme } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { apiGetMe, apiUpdateProfile } from '../services/api';

export default function ProfileEditScreen() {
    const router = useRouter();
    const { user, setUser } = useAuth();
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);

    const [name, setName] = useState(user?.name ?? '');
    const [username, setUsername] = useState(user?.username ?? '');
    const [email, setEmail] = useState(user?.email ?? '');
    const [loading, setLoading] = useState(false);
    const [documents, setDocuments] = useState<any>({
        idCardFront: null,
        idCardBack: null,
        selfie: null
    });

    const pickImage = async (field: string) => {
        let result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            allowsEditing: true,
            aspect: [4, 3],
            quality: 0.1, // très basse qualité pour limiter la taille en Base64
            base64: true
        });

        if (!result.canceled && result.assets[0].base64) {
            setDocuments((prev: any) => ({
                ...prev,
                [field]: `data:image/jpeg;base64,${result.assets[0].base64}`
            }));
        }
    };

    const handleSave = async () => {
        if (name.trim().length < 2) {
            Alert.alert('Erreur', 'Le nom doit comporter au moins 2 caractères.');
            return;
        }

        setLoading(true);
        try {
            await apiUpdateProfile(name.trim(), username.trim(), email.trim(), documents.idCardFront, documents.idCardBack, documents.selfie);
            // Update auth context by re-fetching Me
            const me = await apiGetMe();
            setUser(me);
            Alert.alert('Succès', 'Vos informations ont été mises à jour.', [
                { text: 'OK', onPress: () => router.back() }
            ]);
        } catch (e: any) {
            Alert.alert('Erreur', e.message || 'Impossible de mettre à jour le profil');
        } finally {
            setLoading(false);
        }
    };

    return (
        <SafeAreaView style={styles.safeArea}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>

                {/* Header */}
                <View style={styles.header}>
                    <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                        <Ionicons name="arrow-back" size={24} color={COLORS.textPrimary} />
                    </TouchableOpacity>
                    <Text style={styles.headerTitle}>Modifier mon profil</Text>
                    <View style={{ width: 40 }} />
                </View>

                {/* Form */}
                <View style={styles.formContainer}>
                    <Text style={styles.label}>Nom complet</Text>
                    <View style={styles.inputContainer}>
                        <Ionicons name="person-outline" size={20} color={COLORS.textSecondary} style={{ marginRight: 12 }} />
                        <TextInput
                            style={styles.input}
                            value={name}
                            onChangeText={setName}
                            placeholder="Votre nom"
                            placeholderTextColor={COLORS.textSecondary}
                        />
                    </View>

                    <Text style={styles.label}>Pseudo Unique</Text>
                    <View style={styles.inputContainer}>
                        <Ionicons name="at-outline" size={20} color={COLORS.textSecondary} style={{ marginRight: 12 }} />
                        <TextInput
                            style={styles.input}
                            value={username}
                            onChangeText={t => setUsername(t.replace(/\s/g, '').toLowerCase())}
                            placeholder="Ex: omar01"
                            placeholderTextColor={COLORS.textSecondary}
                            autoCapitalize="none"
                        />
                    </View>

                    <Text style={styles.label}>E-mail (Sécurité Facultative)</Text>
                    <View style={styles.inputContainer}>
                        <Ionicons name="mail-outline" size={20} color={COLORS.textSecondary} style={{ marginRight: 12 }} />
                        <TextInput
                            style={styles.input}
                            value={email}
                            onChangeText={t => setEmail(t.replace(/\s/g, '').toLowerCase())}
                            placeholder="Ex: omar@mongain.com"
                            placeholderTextColor={COLORS.textSecondary}
                            autoCapitalize="none"
                            keyboardType="email-address"
                        />
                    </View>

                    <Text style={styles.infoText}>
                        Votre numéro ({user?.phone}) vous sert d'identifiant principal et ne peut pas être modifié.
                    </Text>

                    {/* Section KYC */}
                    <View style={{ marginTop: 10, padding: 16, backgroundColor: COLORS.surface, borderRadius: 12, borderWidth: 1, borderColor: user?.kycStatus === 'APPROVED' ? '#10b981' : COLORS.border, marginBottom: 24 }}>
                        <Text style={{ fontSize: 16, fontWeight: '700', color: COLORS.textPrimary, marginBottom: 4 }}>Vérification d'Identité (KYC)</Text>
                        {user?.kycStatus === 'APPROVED' ? (
                            <Text style={{ color: '#10b981', fontWeight: '600', marginTop: 5 }}>✅ Compte Certifié (Plafonds maximaux)</Text>
                        ) : user?.kycStatus === 'PENDING' ? (
                            <Text style={{ color: '#f59e0b', fontWeight: '600', marginTop: 5 }}>⏳ Dossier en cours de validation</Text>
                        ) : (
                            <>
                                <Text style={{ color: COLORS.textSecondary, marginBottom: 16, fontSize: 13 }}>Compte standard plafonné (Max 50.000 FCFA/jour). Envoyez vos documents pour l'augmenter.</Text>

                                <ScrollView horizontal style={{ marginBottom: 15 }} showsHorizontalScrollIndicator={false}>
                                    <TouchableOpacity style={[styles.docPicker, documents.idCardFront && { borderColor: '#10b981' }]} onPress={() => pickImage('idCardFront')}>
                                        {documents.idCardFront ? (
                                            <Image source={{ uri: documents.idCardFront }} style={styles.docImage} />
                                        ) : (
                                            <>
                                                <Ionicons name="card" size={24} color={COLORS.primary} />
                                                <Text style={styles.docLabel}>CNI Recto</Text>
                                            </>
                                        )}
                                    </TouchableOpacity>
                                    <TouchableOpacity style={[styles.docPicker, documents.idCardBack && { borderColor: '#10b981' }]} onPress={() => pickImage('idCardBack')}>
                                        {documents.idCardBack ? (
                                            <Image source={{ uri: documents.idCardBack }} style={styles.docImage} />
                                        ) : (
                                            <>
                                                <Ionicons name="card-outline" size={24} color={COLORS.primary} />
                                                <Text style={styles.docLabel}>CNI Verso</Text>
                                            </>
                                        )}
                                    </TouchableOpacity>
                                    <TouchableOpacity style={[styles.docPicker, documents.selfie && { borderColor: '#10b981' }]} onPress={() => pickImage('selfie')}>
                                        {documents.selfie ? (
                                            <Image source={{ uri: documents.selfie }} style={styles.docImage} />
                                        ) : (
                                            <>
                                                <Ionicons name="camera-outline" size={24} color={COLORS.primary} />
                                                <Text style={styles.docLabel}>Selfie Brut</Text>
                                            </>
                                        )}
                                    </TouchableOpacity>
                                </ScrollView>
                                {documents.idCardFront && documents.idCardBack && documents.selfie && (
                                    <Text style={{ color: '#10b981', fontSize: 12, marginBottom: 15, fontWeight: 'bold' }}>Dossier complet ! Enregistrez pour soumettre.</Text>
                                )}
                            </>
                        )}
                    </View>

                    <TouchableOpacity
                        style={[styles.saveButton, ((name.trim() === user?.name || name.trim().length === 0) && username.trim() === (user?.username ?? '') && email.trim() === (user?.email ?? '') && !documents.selfie) && styles.disabledButton]}
                        onPress={handleSave}
                        disabled={loading || ((name.trim() === user?.name || name.trim().length === 0) && username.trim() === (user?.username ?? '') && email.trim() === (user?.email ?? '') && !documents.selfie)}
                    >
                        {loading ? (
                            <ActivityIndicator color={COLORS.surface} />
                        ) : (
                            <Text style={styles.saveButtonText}>Enregistrer</Text>
                        )}
                    </TouchableOpacity>
                </View>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const getStyles = (COLORS: ReturnType<typeof useAppTheme>) => StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: COLORS.background },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, paddingVertical: 16, backgroundColor: COLORS.surface,
        borderBottomWidth: 1, borderBottomColor: COLORS.border,
    },
    backButton: { padding: 8, marginLeft: -8 },
    headerTitle: { color: COLORS.textPrimary, fontSize: 18, fontWeight: '600' },
    formContainer: { padding: 24, flex: 1 },
    label: { fontSize: 16, fontWeight: '600', color: COLORS.textPrimary, marginBottom: 8 },
    inputContainer: {
        flexDirection: 'row', alignItems: 'center',
        backgroundColor: COLORS.surface,
        borderWidth: 1, borderColor: COLORS.border,
        borderRadius: 12, paddingHorizontal: 16, height: 56, marginBottom: 16,
    },
    input: { flex: 1, fontSize: 16, color: COLORS.textPrimary },
    infoText: { fontSize: 14, color: COLORS.textSecondary, marginBottom: 32, lineHeight: 20 },
    saveButton: {
        backgroundColor: COLORS.primary, height: 56, borderRadius: 16,
        justifyContent: 'center', alignItems: 'center',
    },
    disabledButton: { opacity: 0.5 },
    saveButtonText: { color: COLORS.surface, fontSize: 18, fontWeight: '700' },
    docPicker: {
        width: 100, height: 100, backgroundColor: COLORS.primary + '11', borderRadius: 12,
        borderWidth: 1, borderColor: COLORS.primary + '33', borderStyle: 'dashed',
        justifyContent: 'center', alignItems: 'center', marginRight: 15
    },
    docLabel: { fontSize: 11, fontWeight: '600', color: COLORS.primary, marginTop: 5 },
    docImage: { width: '100%', height: '100%', borderRadius: 12 }
});
