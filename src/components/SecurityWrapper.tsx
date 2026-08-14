import { Ionicons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import { useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Dimensions, PanResponder, Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAppTheme } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import { apiVerifyAppLockPin } from '../services/api';

const { width } = Dimensions.get('window');

let lastInteractionTime = Date.now();
const BACKGROUND_LIMIT_MS = 5 * 1000; // 5 seconds grace period when backgrounded
const INACTIVITY_LIMIT_MS = 60 * 1000; // 1 minute of zero screen touch

export function SecurityWrapper({ children }: { children: React.ReactNode }) {
    const { token } = useAuth();
    const router = useRouter();
    const COLORS = useAppTheme();

    const [isLocked, setIsLocked] = useState(false);
    const [isEvaluating, setIsEvaluating] = useState(true); // Bloque le rendu initial
    const [requiresPinFallback, setRequiresPinFallback] = useState(false);
    const [pinCode, setPinCode] = useState('');
    const [pinLoading, setPinLoading] = useState(false);
    const [pinError, setPinError] = useState('');

    const appState = useRef(AppState.currentState);
    const isBooting = useRef(true);

    const panResponder = useRef(
        PanResponder.create({
            onMoveShouldSetPanResponderCapture: () => {
                lastInteractionTime = Date.now();
                return false;
            },
            onStartShouldSetPanResponderCapture: () => {
                lastInteractionTime = Date.now();
                return false;
            },
        })
    ).current;

    // Background Inactivity verification (Background -> Foreground)

    const checkLockAndPrompt = async () => {
        // expo-secure-store is unavailable on web — skip
        if (Platform.OS === 'web') {
            setIsEvaluating(false);
            return;
        }
        const lockPref = await SecureStore.getItemAsync('appLockEnabled');
        // SECURITY UPDATE: AppLock is ON by default (Opt-out)
        if (lockPref !== 'false') {
            setIsLocked(true);
            setTimeout(() => handleUnlock(), 500);
        } else {
            setIsLocked(false);
        }
        setIsEvaluating(false);
    };

    useEffect(() => {
        if (token && isBooting.current) {
            checkLockAndPrompt();
        } else if (!token) {
            setIsEvaluating(false);
        }
        isBooting.current = false;
    }, [token]);

    useEffect(() => {
        // AppState changes are only relevant on native
        if (Platform.OS === 'web') return;

        const subscription = AppState.addEventListener('change', async nextAppState => {
            if (nextAppState.match(/inactive|background/)) {
                lastInteractionTime = Date.now();
            }

            if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
                if (token) {
                    const lockPref = await SecureStore.getItemAsync('appLockEnabled');
                    const timeAway = Date.now() - lastInteractionTime;
                    if (lockPref !== 'false' && timeAway > BACKGROUND_LIMIT_MS) {
                        setIsLocked(true);
                        setRequiresPinFallback(false);
                        handleUnlock();
                    }
                }
            }
            appState.current = nextAppState;
        });

        return () => subscription.remove();
    }, [token]);

    // Active screen inactivity checker loop
    useEffect(() => {
        if (Platform.OS === 'web') return;

        const interval = setInterval(async () => {
            if (!token || isLocked || appState.current !== 'active') return;
            const timeAway = Date.now() - lastInteractionTime;

            // Tracker silencieux

            if (timeAway > INACTIVITY_LIMIT_MS) {
                const lockPref = await SecureStore.getItemAsync('appLockEnabled');
                if (lockPref !== 'false') {
                    setIsLocked(true);
                    setRequiresPinFallback(false);
                    handleUnlock();
                } else {
                    lastInteractionTime = Date.now();
                }
            }
        }, 1000); // Check idle time every 1 second

        return () => clearInterval(interval);
    }, [token, isLocked]);

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
            // No biometric hardware -> Fallback to custom PIN form
            setRequiresPinFallback(true);
        }
    };

    const handleVerifyPin = async () => {
        if (!pinCode || pinCode.length < 4) return;
        setPinLoading(true);
        setPinError('');
        try {
            const res = await apiVerifyAppLockPin(pinCode);
            if (res.success) {
                setPinCode('');
                setRequiresPinFallback(false);
                setIsLocked(false);
                lastInteractionTime = Date.now();
            }
        } catch (e: any) {
            setPinError(e.message || 'Code PIN incorrect');
        } finally {
            setPinLoading(false);
        }
    };

    // On web, the biometric lock is not applicable — transparent passthrough
    if (Platform.OS === 'web') {
        return <>{children}</>;
    }

    // -- Écran de chargement suspense --
    if (token && isEvaluating) {
        return (
            <View style={[styles.container, { backgroundColor: COLORS.background }]}>
                <ActivityIndicator size="large" color={COLORS.primary} />
            </View>
        );
    }

    if (token && isLocked) {
        return (
            <View style={[styles.container, { backgroundColor: COLORS.background }]}>
                <View style={styles.iconContainer}>
                    <Ionicons name="lock-closed" size={64} color={COLORS.primary} />
                </View>
                <Text style={[styles.title, { color: COLORS.textPrimary }]}>Application Verrouillée</Text>

                {requiresPinFallback ? (
                    <View style={{ width: '100%', alignItems: 'center' }}>
                        <Text style={styles.subtitle}>Saisissez votre code PIN Mongain pour déverrouiller l'application.</Text>

                        {pinError ? (
                            <Text style={{ color: '#E11D48', marginBottom: 12, fontWeight: '600' }}>{pinError}</Text>
                        ) : null}

                        <TextInput
                            style={[styles.pinInput, { color: COLORS.textPrimary, borderColor: COLORS.border }]}
                            value={pinCode}
                            onChangeText={setPinCode}
                            keyboardType="numeric"
                            secureTextEntry={true}
                            maxLength={4}
                            placeholder="****"
                            placeholderTextColor={COLORS.textSecondary}
                            autoFocus={true}
                        />

                        <TouchableOpacity
                            style={[styles.unlockBtn, { backgroundColor: COLORS.primary }]}
                            onPress={handleVerifyPin}
                            disabled={pinLoading || pinCode.length < 4}
                        >
                            {pinLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.unlockText}>Valider</Text>}
                        </TouchableOpacity>
                    </View>
                ) : (
                    <View style={{ width: '100%', alignItems: 'center' }}>
                        <Text style={styles.subtitle}>Pour des raisons de sécurité, veuillez utiliser la biométrie pour continuer.</Text>
                        <TouchableOpacity style={[styles.unlockBtn, { backgroundColor: COLORS.primary }]} onPress={handleUnlock}>
                            <Ionicons name="finger-print" size={24} color="#fff" />
                            <Text style={styles.unlockText}>Déverrouiller</Text>
                        </TouchableOpacity>
                    </View>
                )}
            </View>
        );
    }

    return (
        <View style={{ flex: 1 }} {...panResponder.panHandlers}>
            {children}
        </View>
    );
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
    title: { fontSize: 24, fontWeight: '800', marginBottom: 12, textAlign: 'center' },
    subtitle: { fontSize: 16, color: '#6b7280', textAlign: 'center', lineHeight: 24, marginBottom: 32, paddingHorizontal: 20 },
    pinInput: {
        width: 140, height: 60, borderRadius: 16, borderWidth: 1,
        fontSize: 32, fontWeight: '800', textAlign: 'center',
        letterSpacing: 8, marginBottom: 32,
    },
    unlockBtn: {
        flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
        height: 60, width: '100%', borderRadius: 16, gap: 12,
        shadowColor: '#1DC5E9', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 15, elevation: 8,
    },
    unlockText: { fontSize: 18, color: '#fff', fontWeight: '700' }
});
