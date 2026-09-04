
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Tabs, useRouter } from 'expo-router';
import React from 'react';
import { Platform, StyleSheet, View, useColorScheme } from 'react-native';
import { useAppTheme } from '../../constants/theme';
import { TAB_BAR_HEIGHT_BASE, useTabBarHeight } from '../../hooks/useTabBarHeight';

export default function TabLayout() {
    // Couleurs codées en dur précédemment : la tab bar restait blanche même en thème
    // sombre, alors que tout le reste de l'app suit useAppTheme().
    const COLORS = useAppTheme();
    const colorScheme = useColorScheme() ?? 'light';
    const router = useRouter();

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
                    backgroundColor: Platform.OS === 'ios' ? 'transparent' : `${COLORS.surface}F2`,
                    borderTopWidth: 0,
                    elevation: 0,
                    paddingBottom: 8 + bottomInset,
                    paddingTop: 8,
                    height: tabBarHeight,
                },
                tabBarBackground: () => (
                    <BlurView
                        tint={colorScheme === 'dark' ? 'dark' : 'light'}
                        intensity={85}
                        style={StyleSheet.absoluteFill}
                    />
                ),
                tabBarLabelStyle: {
                    fontSize: 11,
                    fontFamily: 'Satoshi-SemiBold',
                    marginTop: 2,
                },
            }}
        >
            <Tabs.Screen
                name="index"
                options={{
                    title: 'Accueil',
                    tabBarIcon: ({ color, size, focused }) => (
                        <Ionicons name={focused ? 'home' : 'home-outline'} size={24} color={color} />
                    ),
                }}
            />
            <Tabs.Screen
                name="history"
                options={{
                    title: 'Historique',
                    tabBarIcon: ({ color, size }) => (
                        <Ionicons name="time-outline" size={24} color={color} />
                    ),
                }}
            />
            <Tabs.Screen
                name="pay"
                listeners={{
                    tabPress: e => {
                        e.preventDefault();
                        router.push('/qr'); // "intelligent" QR code
                    }
                }}
                options={{
                    title: '',
                    tabBarIcon: ({ focused }) => (
                        <View style={{
                            width: 56, height: 56, borderRadius: 28,
                            backgroundColor: COLORS.primary,
                            justifyContent: 'center', alignItems: 'center',
                            marginTop: -20,
                            shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5
                        }}>
                            <Ionicons name="qr-code" size={26} color="#fff" />
                        </View>
                    ),
                }}
            />
            
            <Tabs.Screen
                name="profile"
                options={{
                    title: 'Profil',
                    tabBarIcon: ({ color, size, focused }) => (
                        <Ionicons name={focused ? 'person' : 'person-outline'} size={24} color={color} />
                    ),
                }}
            />
            {/* Hidden screens from the bottom tab bar */}
            <Tabs.Screen name="cards" options={{ href: null }} />
            <Tabs.Screen name="crypto" options={{ href: null }} />
            <Tabs.Screen name="assistant" options={{ href: null }} />
            <Tabs.Screen name="credit" options={{ href: null }} />
        </Tabs>
    );
}





