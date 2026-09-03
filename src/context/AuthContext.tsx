import React, { createContext, useContext, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { io, Socket } from 'socket.io-client';
import { apiGetMe, apiGetSystemSettings, apiLogin, apiLogoutServer, apiRegister, apiResetPIN, apiUpdatePushToken, apiVerifyLoginOtp, BASE_URL, deleteRefreshToken, deleteToken, getToken, saveRefreshToken, saveToken, setUnauthorizedHandler, User } from '../services/api';

import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
    handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
    }),
});

async function registerForPushNotificationsAsync() {
    let token;
    if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('default', {
            name: 'default',
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: '#2563EB',
        });
    }

    if (Device.isDevice) {
        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;
        if (existingStatus !== 'granted') {
            const { status } = await Notifications.requestPermissionsAsync();
            finalStatus = status;
        }
        if (finalStatus !== 'granted') {
            return null;
        }
        try {
            const projectId =
                Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
            if (!projectId) {
                console.warn('Project ID manquant pour Push Notifications');
            }
            token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
        } catch (e) {
            console.error('Erreur token push:', e);
        }
    } else {
        console.warn('Utilisez un appareil physique pour les Push Notifications');
    }
    return token;
}

interface AuthContextType {
    user: User | null;
    token: string | null;
    isLoading: boolean;
    login: (phone: string, pin: string) => Promise<{ requireOtp?: boolean; success?: boolean }>;
    verifyLoginOtp: (phone: string, otpCode: string) => Promise<void>;
    register: (name: string, username: string, phone: string, pin: string, otpCode: string) => Promise<void>;
    resetPin: (phone: string, otpCode: string, newPin: string) => Promise<void>;
    logout: () => Promise<void>;
    setUser: (user: User | null) => void;
    settings: any;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [token, setToken] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [socket, setSocket] = useState<Socket | null>(null);
    const [settings, setSettings] = useState<any>(null);

    // Initialiser les WebSockets quand on est connecté
    useEffect(() => {
        if (!user) {
            if (socket) {
                socket.disconnect();
                setSocket(null);
            }
            return;
        }

        const newSocket = io(BASE_URL);

        newSocket.on('connect', async () => {
            // Toujours relire le token depuis le cache/SecureStore (getToken()) plutôt que
            // d'utiliser la variable `token` figée dans la closure de cet effet : le
            // renouvellement silencieux (tryRefreshSession, services/api.ts) écrit le nouveau
            // token dans le cache module + SecureStore mais n'appelle jamais setToken() ici —
            // l'état React `token` reste donc bloqué sur sa valeur de connexion initiale.
            // Sans ce correctif, le PREMIER 'connect' fonctionnait (token encore frais), mais
            // toute reconnexion automatique ultérieure (veille du backend Render en plan
            // gratuit après inactivité, coupure réseau, retour en premier plan de l'app...)
            // ré-émettait ce même token désormais expiré : le serveur rejetait silencieusement
            // le 'register' (voir resolveSocketRoom) et le client cessait de recevoir toute
            // notification temps réel jusqu'au redémarrage complet de l'app — exactement le
            // symptôme "les notifications passaient avant, plus maintenant".
            try {
                const freshToken = await getToken();
                console.log('🔗 WebSocket connecté, enregistrement pour', user.phone);
                if (freshToken) newSocket.emit('register', freshToken);
            } catch (e) {
                console.error('Erreur lecture token pour enregistrement WebSocket:', e);
            }
        });

        newSocket.on('payment_received', (data: { amount: number, from: string }) => {
            Alert.alert(
                '💰 Paiement Reçu !',
                `Vous venez de recevoir ${data.amount.toLocaleString('fr-FR')} FCFA depuis ${data.from}.`,
                [{ text: 'Super !' }]
            );
        });

        // SOCKET.IO FALLBACK: Bypass firebase restriction using local Native OS notifications
        newSocket.on('global_push', async (data: { title: string, body: string }) => {
            try {
                await Notifications.scheduleNotificationAsync({
                    content: { title: data.title, body: data.body, sound: true },
                    trigger: null // déclenche immédiatement !
                });
            } catch (e) { console.error('Local Push error:', e); }
        });

        setSocket(newSocket);

        // Enregistrer le push token en arrière-plan
        registerForPushNotificationsAsync().then(token => {
            if (token) {
                console.log('📱 Push Token obtenu:', token);
                // Best-effort, comme apiLogoutServer() ci-dessous : si la session vient
                // d'expirer (ex. juste après un changement de PIN, qui la révoque
                // volontairement), _onUnauthorized() a déjà déconnecté l'utilisateur —
                // consigner cet échec via console.error ne faisait qu'afficher un écran
                // d'erreur rouge alarmant pour un enregistrement de notification par
                // ailleurs sans conséquence (retenté à la prochaine connexion).
                apiUpdatePushToken(token).catch(() => { });
            }
        });

        return () => {
            newSocket.disconnect();
        };
        // `token` volontairement absent des dépendances : ce socket ne doit être recréé qu'au
        // changement de session (connexion/déconnexion), jamais à chaque renouvellement
        // silencieux du token — celui-ci est relu à la volée via getToken() à chaque 'connect'
        // ci-dessus (initial ET reconnexions automatiques), donc toujours à jour sans avoir à
        // reconstruire le socket.
    }, [user?.phone]);

    const logout = async () => {
        // Best-effort : révoque le refresh token côté serveur, mais la session locale
        // doit être effacée dans tous les cas (hors ligne, serveur indisponible...).
        try {
            await apiLogoutServer();
        } catch {
            // Ignoré : l'essentiel est de nettoyer la session locale ci-dessous.
        }
        await deleteToken();
        await deleteRefreshToken();
        setToken(null);
        setUser(null);
    };

    // Récupère les paramètres publics (taux de frais, seuils, etc.) — appelé au
    // démarrage ET après chaque connexion, pour éviter que des écrans (transfert,
    // retrait...) ne retombent sur des valeurs par défaut codées en dur si l'app
    // n'a pas redémarré depuis la connexion.
    const fetchSettings = async () => {
        try {
            setSettings(await apiGetSystemSettings());
        } catch {
            // Non bloquant : les écrans ont leurs propres valeurs de repli.
        }
    };

    // Enregistrer le handler d'auto-logout pour les 401 API
    useEffect(() => {
        setUnauthorizedHandler(logout);
    }, []);

    // Détection root/jailbreak "best-effort" (Device.isRootedExperimentalAsync, expo-device —
    // déjà une dépendance existante, aucun module natif supplémentaire requis). Explicitement
    // documentée "experimental" côté Expo : contournable et capable de faux positifs sur
    // certains appareils non modifiés. Pour une application financière, un avertissement NON
    // bloquant est préféré à un blocage total : un faux positif bloquant priverait un
    // utilisateur légitime de son argent, ce qui est pire que le risque résiduel d'un
    // utilisateur rooté simplement averti (même logique de prudence que le report du certificate
    // pinning, différé faute de pouvoir le valider sur un vrai appareil).
    useEffect(() => {
        Device.isRootedExperimentalAsync()
            .then(isRooted => {
                if (isRooted) {
                    Alert.alert(
                        '⚠️ Appareil non sécurisé détecté',
                        "Votre téléphone semble avoir été débridé (root/jailbreak). Cela peut exposer vos données bancaires à des applications malveillantes installées sur cet appareil. Nous vous recommandons vivement de ne pas utiliser Mongain ici tant que ce n'est pas résolu.",
                        [{ text: "J'ai compris" }]
                    );
                }
            })
            .catch(() => {
                // Best-effort : une erreur de détection ne doit jamais empêcher le démarrage de l'app.
            });
    }, []);

    // Restaurer la session complète au démarrage
    useEffect(() => {
        const restoreSession = async () => {
            try {
                const storedToken = await getToken();
                if (storedToken) {
                    setToken(storedToken);
                    // Récupérer le profil complet depuis le backend
                    const me = await apiGetMe();
                    setUser(me);
                    await fetchSettings();
                }
            } catch {
                // Token invalide ou expiré → nettoyer
                try {
                    await deleteToken();
                } catch (e) {
                    // Ignore secure store delete errors
                }
                setToken(null);
                setUser(null);
            } finally {
                setIsLoading(false);
            }
        };
        restoreSession();
    }, []);

    const login = async (phone: string, pin: string) => {
        const res = await apiLogin(phone, pin);
        if (res.requireOtp) {
            return { requireOtp: true };
        }
        if (res.token && res.user) {
            await saveToken(res.token);
            // Sans ceci, un compte connecté par PIN seul (sans 2FA) n'avait aucun refresh
            // token stocké — contrairement à verifyLoginOtp/register/resetPin — et se
            // retrouvait déconnecté de force dès l'expiration du token d'accès court.
            if (res.refreshToken) await saveRefreshToken(res.refreshToken);
            setToken(res.token);
            setUser(res.user);
            await fetchSettings();
            return { success: true };
        }
        return { success: false };
    };

    const verifyLoginOtp = async (phone: string, otpCode: string) => {
        const { token: newToken, refreshToken, user: newUser } = await apiVerifyLoginOtp(phone, otpCode);
        await saveToken(newToken);
        await saveRefreshToken(refreshToken);
        setToken(newToken);
        setUser(newUser);
        await fetchSettings();
    };

    const register = async (name: string, username: string, phone: string, pin: string, otpCode: string) => {
        const { token: newToken, refreshToken, user: newUser } = await apiRegister(name, username, phone, pin, otpCode);
        await saveToken(newToken);
        await saveRefreshToken(refreshToken);
        setToken(newToken);
        setUser(newUser);
        await fetchSettings();
    };

    // Le backend renvoie une session complète en cas de succès (comme register/verifyLoginOtp),
    // pas un simple message — autant reconnecter directement l'utilisateur plutôt que le
    // renvoyer se reconnecter manuellement avec le PIN qu'il vient tout juste de définir.
    const resetPin = async (phone: string, otpCode: string, newPin: string) => {
        const { token: newToken, refreshToken, user: newUser } = await apiResetPIN(phone, otpCode, newPin);
        await saveToken(newToken);
        await saveRefreshToken(refreshToken);
        setToken(newToken);
        setUser(newUser);
        await fetchSettings();
    };

    return (
        <AuthContext.Provider value={{ user, token, isLoading, login, verifyLoginOtp, register, resetPin, logout, setUser, settings }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth doit être utilisé dans un AuthProvider');
    return ctx;
};
