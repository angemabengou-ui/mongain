import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

// En-tête (retour + titre) identique entre vault-detail.tsx et tontine-detail.tsx —
// recopié verbatim dans les deux avant cette extraction.
export default function ScreenHeader({ title, onBack }: { title: string; onBack: () => void }) {
    return (
        <View style={styles.header}>
            <TouchableOpacity style={styles.headerBtn} onPress={onBack}>
                <Ionicons name="arrow-back" size={24} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
            <View style={{ width: 44 }} />
        </View>
    );
}

const styles = StyleSheet.create({
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 12 },
    headerBtn: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
    headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff', flex: 1, textAlign: 'center', marginHorizontal: 8 },
});
