
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Tabs } from 'expo-router';
import React from 'react';
import { Platform, StyleSheet, useColorScheme } from 'react-native';
import { useAppTheme } from '../../constants/theme';
import { TAB_BAR_HEIGHT_BASE, useTabBarHeight } from '../../hooks/useTabBarHeight';

export default function TabLayout() {
    // Couleurs codées en dur précédemment : la tab bar restait blanche même en thème
    // sombre, alors que tout le reste de l'app suit useAppTheme().
    const COLORS = useAppTheme();
    const colorScheme = useColorScheme() ?? 'light';

    // Hauteur totale (base + inset bas défensif) — voir useTabBarHeight.ts. Chaque écran
    // d'onglet réutilise le même hook pour compenser dans son propre padding bas, la tab
    // bar étant en position absolute et ne réservant donc pas sa place dans le flux.
    const tabBarHeight = useTabBarHeight();
    const bottomInset = tabBarHeight - TAB_BAR_HEIGHT_BASE;

    return (
        <Tabs
            screenOptions={{
                headerShown: false,
                tabBarActiveTintColor: COLORS.primary,
                tabBarInactiveTintColor: COLORS.textSecondary,
                tabBarStyle: {
                    position: 'absolute',
                    backgroundColor: Platform.OS === 'ios' ? 'transparent' : `${COLORS.surface}E6`,
                    borderTopWidth: 0,
                    elevation: 0,
                    paddingBottom: 8 + bottomInset,
                    paddingTop: 8,
                    height: tabBarHeight,
                },
                tabBarBackground: () => (
                    <BlurView
                        tint={colorScheme === 'dark' ? 'dark' : 'light'}
                        intensity={Platform.OS === 'ios' ? 85 : 100}
                        style={StyleSheet.absoluteFill}
                    />
                ),
                tabBarLabelStyle: {
                    fontSize: 12,
                    fontWeight: '600',
                    marginTop: 2,
                },
            }}
        >
            <Tabs.Screen
                name="index"
                options={{
                    title: 'Accueil',
                    tabBarIcon: ({ color, size, focused }) => (
                        <Ionicons name={focused ? 'home' : 'home-outline'} size={size} color={color} />
                    ),
                }}
            />
            <Tabs.Screen
                name="history"
                options={{
                    title: 'Historique',
                    tabBarIcon: ({ color, size, focused }) => (
                        <Ionicons name={focused ? 'receipt' : 'receipt-outline'} size={size} color={color} />
                    ),
                }}
            />
            <Tabs.Screen
                name="profile"
                options={{
                    title: 'Profil',
                    tabBarIcon: ({ color, size, focused }) => (
                        <Ionicons name={focused ? 'person' : 'person-outline'} size={size} color={color} />
                    ),
                }}
            />
            <Tabs.Screen
                name="cards"
                options={{
                    title: 'Cartes',
                    tabBarIcon: ({ color, size, focused }) => (
                        <Ionicons name={focused ? 'card' : 'card-outline'} size={size} color={color} />
                    ),
                }}
            />
            <Tabs.Screen
                name="crypto"
                options={{
                    title: 'Crypto V8',
                    tabBarIcon: ({ color, size, focused }) => (
                        <Ionicons name={focused ? 'trending-up' : 'trending-up-outline'} size={size} color={color} />
                    ),
                }}
            />
            <Tabs.Screen
                name="assistant"
                options={{
                    title: 'Assistant IA',
                    tabBarIcon: ({ color, size, focused }) => (
                        <Ionicons name={focused ? 'chatbubbles' : 'chatbubbles-outline'} size={size} color={color} />
                    ),
                }}
            />
            <Tabs.Screen
                name="pay"
                options={{
                    title: 'Payer',
                    tabBarIcon: ({ color, size, focused }) => (
                        <Ionicons name={focused ? 'qr-code' : 'qr-code-outline'} size={size} color={color} />
                    ),
                }}
            />
        </Tabs>
    );
}





