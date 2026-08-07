import { Ionicons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import { Tabs } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import React, { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const COLORS = {
    primary: '#1DC5E9',
    textSecondary: '#6b7280',
    surface: '#ffffff',
    background: '#130925',
};

export default function TabLayout() {
    const insets = useSafeAreaInsets();
    const appState = useRef(AppState.currentState);
    const [isLocked, setIsLocked] = useState(false);
    const [lockEnabled, setLockEnabled] = useState(false);

    // Initial check on mount
    useEffect(() => {
        checkLockPreferenceAndAuthenticate();
    }, []);

    // AppState listener for background -> foreground transitions
    useEffect(() => {
        const subscription = AppState.addEventListener('change', nextAppState => {
            if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
                if (lockEnabled) setIsLocked(true); // Lock the app when returning to foreground
            }
            appState.current = nextAppState;
        });
        return () => subscription.remove();
    }, [lockEnabled]);

    const checkLockPreferenceAndAuthenticate = async () => {
        const enabled = await SecureStore.getItemAsync('appLockEnabled');
        if (enabled === 'true') {
            setLockEnabled(true);
            setIsLocked(true);
            triggerBiometrics();
        }
    };

    const triggerBiometrics = async () => {
        const hasHardware = await LocalAuthentication.hasHardwareAsync();
        const isEnrolled = await LocalAuthentication.isEnrolledAsync();

        if (hasHardware && isEnrolled) {
            const result = await LocalAuthentication.authenticateAsync({
                promptMessage: 'Déverrouiller Mongain',
                cancelLabel: 'Annuler',
                disableDeviceFallback: false,
            });
            if (result.success) {
                setIsLocked(false);
            }
        } else {
            // Pas de biométrie dispo sur l'appareil, fail open or require PIN?
            setIsLocked(false);
        }
    };

    if (isLocked) {
        return (
            <View style={[styles.lockedContainer, { paddingTop: insets.top }]}>
                <Ionicons name="lock-closed" size={80} color="#208AEF" style={{ marginBottom: 20 }} />
                <Text style={styles.lockedText}>L'application est verrouillée.</Text>
                <TouchableOpacity style={styles.unlockBtn} onPress={triggerBiometrics}>
                    <Ionicons name="finger-print" size={24} color="#FFF" style={{ marginRight: 10 }} />
                    <Text style={styles.unlockBtnText}>Touch/Face ID pour ouvrir</Text>
                </TouchableOpacity>
            </View>
        );
    }

    return (
        <Tabs
            screenOptions={{
                headerShown: false,
                tabBarActiveTintColor: COLORS.primary,
                tabBarInactiveTintColor: COLORS.textSecondary,
                tabBarStyle: {
                    backgroundColor: COLORS.surface,
                    borderTopWidth: 1,
                    borderTopColor: '#f1f5f9',
                    paddingBottom: 8 + insets.bottom,
                    paddingTop: 8,
                    height: 65 + insets.bottom,
                    shadowColor: '#000',
                    shadowOffset: { width: 0, height: -4 },
                    shadowOpacity: 0.06,
                    shadowRadius: 12,
                    elevation: 10,
                },
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

const styles = StyleSheet.create({
    lockedContainer: {
        flex: 1,
        backgroundColor: COLORS.background,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 20
    },
    lockedText: {
        color: '#FFF',
        fontSize: 20,
        fontWeight: 'bold',
        marginBottom: 30
    },
    unlockBtn: {
        flexDirection: 'row',
        backgroundColor: '#208AEF',
        paddingHorizontal: 30,
        paddingVertical: 14,
        borderRadius: 12,
        alignItems: 'center'
    },
    unlockBtnText: {
        color: '#FFF',
        fontSize: 16,
        fontWeight: 'bold'
    }
});
