import { Ionicons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import React, { useEffect, useRef, useState } from 'react';
import { AppState, Dimensions, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAppTheme } from '../constants/theme';
import { useAuth } from '../context/AuthContext';

const { width } = Dimensions.get('window');

let lastInteractionTime = Date.now();
const INACTIVITY_LIMIT_MS = 60 * 1000;

export function SecurityWrapper({ children }: { children: React.ReactNode }) {
    const { token } = useAuth();
    const router = useRouter();
    const COLORS = useAppTheme();

    // All hooks must be called before any conditional return (React rules of hooks)
    const [isLocked, setIsLocked] = useState(false);
    const appState = useRef(AppState.currentState);
    const isBooting = useRef(true);

    const checkLockAndPrompt = async () => {
        // expo-secure-store is unavailable on web — skip
        if (Platform.OS === 'web') return;
        const lockPref = await SecureStore.getItemAsync('appLockEnabled');
        if (lockPref === 'true') {
            setIsLocked(true);
            setTimeout(() => handleUnlock(), 500);
        } else {
            setIsLocked(false);
        }
    };

    useEffect(() => {
        if (token && isBooting.current) {
            checkLockAndPrompt();
        }
        isBooting.current = false;
    }, [token]);

    useEffect(() => {
        // AppState changes are only relevant on native
        if (Platform.OS === 'web') return;

        const subscription = AppState.addEventListener('change', async nextAppState => {
            if (appState.current.match(/active/) && nextAppState === 'background') {
                lastInteractionTime = Date.now();
            }

            if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
                if (token) {
                    const lockPref = await SecureStore.getItemAsync('appLockEnabled');
                    if (lockPref === 'true') {
                        setIsLocked(true);
                        handleUnlock();
                    }
                }
            }
            appState.current = nextAppState;
        });

        return () => subscription.remove();
    }, [token]);

    const handleUnlock = async () => {
        // expo-local-authentication is unavailable on web
        if (Platform.OS === 'web') {
            setIsLocked(false);
            return;
        }
        const hasHardware = await LocalAuthentication.hasHardwareAsync();
        const isEnrolled = await LocalAuthentication.isEnrolledAsync();

        if (hasHardware && isEnrolled) {
            const result = await LocalAuthentication.authenticateAsync({
                promptMessage: 'Déverrouillez Mongain',
                fallbackLabel: 'Utiliser le code PIN',
                disableDeviceFallback: false,
            });

            if (result.success) {
                lastInteractionTime = Date.now();
                setIsLocked(false);
            }
        } else {
            setIsLocked(false);
        }
    };

    // On web, the biometric lock is not applicable — transparent passthrough
    if (Platform.OS === 'web') {
        return <>{children}</>;
    }

    if (token && isLocked) {
        return (
            <View style={[styles.container, { backgroundColor: COLORS.background }]}>
                <View style={styles.iconContainer}>
                    <Ionicons name="lock-closed" size={64} color={COLORS.primary} />
                </View>
                <Text style={styles.title}>Application Verrouillée</Text>
                <Text style={styles.subtitle}>Pour des raisons de sécurité, veuillez vous authentifier pour continuer.</Text>

                <TouchableOpacity style={[styles.unlockBtn, { backgroundColor: COLORS.primary }]} onPress={handleUnlock}>
                    <Ionicons name="finger-print" size={24} color="#fff" />
                    <Text style={styles.unlockText}>Déverrouiller</Text>
                </TouchableOpacity>
            </View>
        );
    }

    return <>{children}</>;
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
    },
    iconContainer: {
        width: 120, height: 120, borderRadius: 60,
        backgroundColor: 'rgba(29, 197, 233, 0.1)',
        justifyContent: 'center', alignItems: 'center',
        marginBottom: 32,
    },
    title: { fontSize: 24, fontWeight: '800', color: '#fff', marginBottom: 12, textAlign: 'center' },
    subtitle: { fontSize: 16, color: '#94a3b8', textAlign: 'center', lineHeight: 24, marginBottom: 48, paddingHorizontal: 20 },
    unlockBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        height: 60, width: '100%', borderRadius: 16, gap: 12,
        shadowColor: '#1DC5E9', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 15, elevation: 8,
    },
    unlockText: { fontSize: 18, color: '#fff', fontWeight: '700' }
});
