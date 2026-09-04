import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppTheme } from '../constants/theme';
import { AppNotification, apiGetNotifications, apiMarkAsRead } from '../services/api';

export default function NotificationsScreen() {
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);
    const router = useRouter();
    const [notifications, setNotifications] = useState<AppNotification[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const loadNotifications = async () => {
        try {
            const data = await apiGetNotifications();
            setNotifications(data);
        } catch (e) {
            console.error('Erreur char. notifications', e);
        } finally {
            setLoading(false);
        }
    };

    useFocusEffect(useCallback(() => { loadNotifications(); }, []));

    const handleRefresh = async () => {
        setRefreshing(true);
        await loadNotifications();
        setRefreshing(false);
    };

    const handleMarkAsRead = async (id?: string) => {
        try {
            await apiMarkAsRead(id);
            if (id) {
                setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
            } else {
                setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
            }
        } catch (e) {
            console.error(e);
        }
    };

    const getIconInfo = (type: string) => {
        switch (type) {
            case 'TRANSACTION': return { icon: 'swap-horizontal', color: COLORS.primary };
            case 'SECURITY': return { icon: 'shield-checkmark', color: COLORS.error };
            case 'SYSTEM': return { icon: 'information-circle', color: '#f59e0b' };
            // Gel/pause/dissolution d'une caisse ou tontine, bon annulé, cotisation en échec…
            // — ce type existait déjà (côté serveur) avant même les notifications ajoutées
            // cette session, mais n'avait jamais été géré ici : sans ce cas, une alerte
            // méritant d'être visible ressortait identique à une notification anodine (cloche
            // grise par défaut), ce qui annule l'intérêt même de l'avoir envoyée.
            case 'ALERT': return { icon: 'warning', color: COLORS.error };
            default: return { icon: 'notifications', color: COLORS.textSecondary };
        }
    };

    return (
        <SafeAreaView style={styles.safeArea}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
                    <Ionicons name="arrow-back" size={24} color={COLORS.textPrimary} />
                </TouchableOpacity>
                <Text style={styles.headerTitle}>Notifications</Text>
                {notifications.some(n => !n.isRead) ? (
                    <TouchableOpacity onPress={() => handleMarkAsRead()}>
                        <Text style={{ fontSize: 13, color: COLORS.primary, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' }}>Tout lire</Text>
                    </TouchableOpacity>
                ) : <View style={{ width: 50 }} />}
            </View>

            {loading ? (
                <View style={styles.center}>
                    <ActivityIndicator size="large" color={COLORS.primary} />
                </View>
            ) : (
                <ScrollView
                    contentContainerStyle={styles.container}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={COLORS.primary} />}
                >
                    {notifications.length === 0 ? (
                        <View style={styles.emptyWrap}>
                            <Ionicons name="notifications-off-outline" size={60} color={COLORS.border} />
                            <Text style={styles.emptyText}>Aucune notification pour le moment.</Text>
                        </View>
                    ) : (
                        notifications.map(n => {
                            const { icon, color } = getIconInfo(n.type);
                            return (
                                <TouchableOpacity
                                    key={n.id}
                                    style={[styles.card, !n.isRead && styles.cardUnread]}
                                    onPress={() => !n.isRead && handleMarkAsRead(n.id)}
                                >
                                    <View style={[styles.iconWrap, { backgroundColor: color + '15' }]}>
                                        <Ionicons name={icon as any} size={22} color={color} />
                                    </View>
                                    <View style={styles.textWrap}>
                                        <Text style={[styles.title, !n.isRead && { fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' }]}>{n.title}</Text>
                                        <Text style={styles.body}>{n.body}</Text>
                                        <Text style={styles.time}>{new Date(n.createdAt).toLocaleString('fr-FR')}</Text>
                                    </View>
                                    {!n.isRead && <View style={styles.unreadDot} />}
                                </TouchableOpacity>
                            );
                        })
                    )}
                </ScrollView>
            )}
        </SafeAreaView>
    );
}

const getStyles = (COLORS: ReturnType<typeof useAppTheme>) => StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: COLORS.background },
    header: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
        paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: COLORS.border,
        backgroundColor: COLORS.surface
    },
    backBtn: { padding: 4 },
    headerTitle: { fontSize: 18, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', color: COLORS.textPrimary },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    container: { padding: 20 },
    emptyWrap: { alignItems: 'center', marginTop: 100 },
    emptyText: { marginTop: 16, fontSize: 16, color: COLORS.textSecondary, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' },

    card: {
        flexDirection: 'row', backgroundColor: COLORS.surface, borderRadius: 16,
        padding: 16, marginBottom: 12, alignItems: 'center',
        borderWidth: 1, borderColor: COLORS.border
    },
    cardUnread: {
        borderColor: COLORS.primary + '55',
        backgroundColor: COLORS.primary + '05',
    },
    iconWrap: {
        width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', marginRight: 16
    },
    textWrap: { flex: 1 },
    title: { fontSize: 15, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', color: COLORS.textPrimary, marginBottom: 4 },
    body: { fontSize: 13, color: COLORS.textSecondary, lineHeight: 18, marginBottom: 6, fontFamily: 'Satoshi-Regular' },
    time: { fontSize: 11, color: COLORS.textSecondary, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' },
    unreadDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.primary, marginLeft: 10 }
});
