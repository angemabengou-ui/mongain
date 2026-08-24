import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Tabs } from 'expo-router';
import React from 'react';
import { Platform, StyleSheet, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../../constants/theme';

export default function TabLayout() {
    const insets = useSafeAreaInsets();
    // Couleurs codées en dur précédemment : la tab bar restait blanche même en thème
    // sombre, alors que tout le reste de l'app suit useAppTheme().
    const COLORS = useAppTheme();
    const colorScheme = useColorScheme() ?? 'light';

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
                    paddingBottom: 8 + insets.bottom,
                    paddingTop: 8,
                    height: 65 + insets.bottom,
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
        </Tabs>
    );
}


