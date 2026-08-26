import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import type { useAppTheme } from '../../constants/theme';

// Formulaire d'invitation par téléphone — recopié verbatim (préfixe +241, gestion du 0
// initial) entre vault-detail.tsx et tontine-detail.tsx avant cette extraction.
export default function InlineInviteForm({ colors, onInvite, style }: {
    colors: ReturnType<typeof useAppTheme>;
    onInvite: (formattedPhone: string) => Promise<void>;
    style?: object;
}) {
    const [phone, setPhone] = useState('');
    const [loading, setLoading] = useState(false);

    const submit = async () => {
        if (!phone.trim() || loading) return;
        setLoading(true);
        try {
            let formatted = phone.trim();
            if (!formatted.startsWith('+')) {
                if (formatted.startsWith('0')) formatted = formatted.substring(1);
                formatted = '+241' + formatted;
            }
            await onInvite(formatted);
            setPhone('');
        } finally {
            setLoading(false);
        }
    };

    return (
        <View style={[styles.inlineForm, { backgroundColor: colors.surface, borderColor: colors.border }, style]}>
            <TextInput
                style={[styles.inlineInput, { color: colors.textPrimary }]}
                placeholder="Téléphone (ex : 074...)"
                placeholderTextColor={colors.textSecondary}
                keyboardType="phone-pad"
                value={phone}
                onChangeText={setPhone}
            />
            <TouchableOpacity
                style={[styles.inlineBtn, { backgroundColor: colors.primary }, (!phone || loading) && styles.disabled]}
                onPress={submit}
                disabled={!phone || loading}
            >
                {loading ? <ActivityIndicator color="#fff" size="small" /> : <Ionicons name="send" size={18} color="#fff" />}
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    inlineForm: { flexDirection: 'row', gap: 10, borderRadius: 14, borderWidth: 1, padding: 8, alignItems: 'center' },
    inlineInput: { flex: 1, height: 42, paddingHorizontal: 12, fontSize: 15 },
    inlineBtn: { paddingHorizontal: 18, height: 42, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
    disabled: { opacity: 0.5 },
});
