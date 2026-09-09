import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { useAppTheme } from '../../constants/theme';

// Remplace Alert.prompt, qui n'existe que sur iOS — sur Android, react-native.Alert.prompt
// est un no-op total (ni boîte de dialogue, ni callback) : un bouton "Confirmer" censé
// demander le code PIN ne faisait alors strictement rien, sans la moindre erreur visible.
// Ce composant centralise le correctif déjà appliqué une première fois dans split.tsx (même
// schéma : Modal + TextInput dédié) pour éviter de le recopier — et de risquer d'oublier une
// plateforme — à chaque nouvel écran demandant un code PIN.
export default function PinPromptModal({ visible, title, message, loading, onConfirm, onCancel, colors }: {
    visible: boolean;
    title: string;
    message: string;
    loading?: boolean;
    onConfirm: (pin: string) => void;
    onCancel: () => void;
    colors: ReturnType<typeof useAppTheme>;
}) {
    const [pin, setPin] = useState('');

    useEffect(() => {
        if (visible) setPin('');
    }, [visible]);

    return (
        <Modal transparent animationType="fade" visible={visible} onRequestClose={onCancel}>
            <View style={styles.overlay}>
                <View style={[styles.card, { backgroundColor: colors.surface }]}>
                    <Text style={[styles.title, { color: colors.textPrimary }]}>{title}</Text>
                    <Text style={[styles.message, { color: colors.textSecondary }]}>{message}</Text>
                    <TextInput
                        style={[styles.input, { color: colors.textPrimary, borderColor: colors.border, backgroundColor: colors.background }]}
                        placeholder="⬢⬢⬢⬢"
                        placeholderTextColor={colors.textSecondary}
                        keyboardType="number-pad"
                        secureTextEntry
                        maxLength={4}
                        value={pin}
                        onChangeText={setPin}
                        autoFocus
                    />
                    <View style={styles.actions}>
                        <TouchableOpacity style={[styles.btn, styles.btnCancel, { borderColor: colors.border }]} onPress={onCancel} disabled={loading}>
                            <Text style={[styles.btnText, { color: colors.textSecondary }]}>Annuler</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.btn, { backgroundColor: colors.primary }, (loading || pin.length !== 4) && { opacity: 0.5 }]}
                            onPress={() => onConfirm(pin)}
                            disabled={loading || pin.length !== 4}
                        >
                            {loading ? <ActivityIndicator color="#fff" /> : <Text style={[styles.btnText, { color: '#fff' }]}>Confirmer</Text>}
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 },
    card: { width: '100%', maxWidth: 360, borderRadius: 20, padding: 24 },
    title: { fontSize: 18, fontFamily: 'Satoshi-SemiBold', fontWeight: '700', marginBottom: 8, textAlign: 'center' },
    message: { fontSize: 14, lineHeight: 20, textAlign: 'center', marginBottom: 20 },
    input: { borderWidth: 1.5, borderRadius: 14, height: 56, fontSize: 24, textAlign: 'center', letterSpacing: 10, marginBottom: 20 },
    actions: { flexDirection: 'row', gap: 12 },
    btn: { flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
    btnCancel: { borderWidth: 1 },
    btnText: { fontSize: 15, fontFamily: 'Satoshi-SemiBold', fontWeight: '700' },
});
