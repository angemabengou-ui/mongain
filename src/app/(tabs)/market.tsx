import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Alert, Image, RefreshControl, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { apiBuyMarketItem, apiGetMarketListings } from '../../services/api';

export default function MongainMarket() {
    const [listings, setListings] = useState<any[]>([]);
    const [refreshing, setRefreshing] = useState(false);
    const { user } = useAuth();

    // Simulate real photos
    const placeholderImages = [
        "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400&q=80",
        "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400&q=80",
        "https://images.unsplash.com/photo-1583394838336-acd977736f90?w=400&q=80"
    ];

    const fetchListings = async () => {
        setRefreshing(true);
        try {
            const res = await apiGetMarketListings();
            setListings(res.listings || []);
        } catch (error) {
            console.error(error);
        }
        setRefreshing(false);
    };

    useEffect(() => {
        fetchListings();
    }, []);

    const handleBuy = (item: any) => {
        Alert.prompt("Confirmation (Escrow)",
            `Acheter ${item.title} pour ${item.price} FCFA ?\n\nLes fonds seront bloqués de manière sécurisée par Mongain jusqu'à réception du produit.\n\nSaisissez votre code PIN :`,
            [
                { text: 'Annuler', style: 'cancel' },
                {
                    text: 'Acheter & Bloquer les fonds',
                    onPress: async (pin?: string) => {
                        if (!pin) return;
                        try {
                            const res = await apiBuyMarketItem(item.id, pin);
                            Alert.alert("Succès !", res.message);
                            fetchListings();
                        } catch (e: any) {
                            Alert.alert('Erreur', e.response?.data?.error || e.message || "Erreur de paiement Escrow");
                        }
                    }
                }
            ],
            'secure-text'
        );
    };

    return (
        <View style={{ flex: 1, backgroundColor: '#F8F9FA' }}>
            <View style={{ padding: 20, paddingTop: 60, backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#EEE' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <View>
                        <Text style={{ fontSize: 28, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', color: '#1A1A1A' }}>Mongain Market</Text>
                        <Text style={{ color: '#059669', fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', fontSize: 13, marginTop: 4 }}>
                            <Ionicons name="shield-checkmark" size={14} /> PAIEMENT 100% SÉCURISÉ
                        </Text>
                    </View>
                    <TouchableOpacity onPress={fetchListings} style={{ backgroundColor: '#F0FDF4', padding: 10, borderRadius: 12 }}>
                        <Ionicons name="refresh" size={24} color="#059669" />
                    </TouchableOpacity>
                </View>
            </View>

            <ScrollView
                contentContainerStyle={{ padding: 16 }}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={fetchListings} />}
            >
                {listings.map((item, idx) => (
                    <View key={item.id} style={{ backgroundColor: '#FFF', borderRadius: 16, padding: 16, marginBottom: 16, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 10 }}>
                        <Image source={{ uri: placeholderImages[idx % 3] }} style={{ width: '100%', height: 180, borderRadius: 12, marginBottom: 12 }} />

                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <View style={{ flex: 1 }}>
                                <Text style={{ fontSize: 18, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', color: '#1A1A1A' }} numberOfLines={1}>{item.title}</Text>
                                <Text style={{ fontSize: 13, color: '#666', marginTop: 4, fontFamily: 'Satoshi-Regular' }}>
                                    Vendeur Vérifié: {item.seller?.name || item.sellerId.substring(0, 8)}
                                </Text>
                            </View>
                            <Text style={{ fontSize: 20, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold', color: '#059669' }}>
                                {item.price.toLocaleString()} F
                            </Text>
                        </View>

                        <Text style={{ color: '#444', marginTop: 12, lineHeight: 20, fontFamily: 'Satoshi-Regular' }}>{item.description}</Text>

                        {user?.id !== item.sellerId ? (
                            <TouchableOpacity onPress={() => handleBuy(item)} style={{ backgroundColor: '#1A1A1A', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 16, flexDirection: 'row', justifyContent: 'center' }}>
                                <Ionicons name="lock-closed" size={18} color="#FFF" style={{ marginRight: 8 }} />
                                <Text style={{ color: '#FFF', fontSize: 16, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' }}>Acheter via Escrow</Text>
                            </TouchableOpacity>
                        ) : (
                            <View style={{ backgroundColor: '#F3F4F6', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 16 }}>
                                <Text style={{ color: '#6B7280', fontSize: 14, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' }}>Votre Annonce</Text>
                            </View>
                        )}
                    </View>
                ))}

                {listings.length === 0 && !refreshing && (
                    <View style={{ alignItems: 'center', marginTop: 40 }}>
                        <Ionicons name="basket-outline" size={64} color="#CBD5E1" />
                        <Text style={{ color: '#94A3B8', marginTop: 16, fontSize: 16, fontFamily: 'Satoshi-SemiBold', fontWeight: 'bold' }}>Le marché est vide pour le moment.</Text>
                    </View>
                )}
            </ScrollView>
        </View>
    );
}
