import React, { createContext, useContext, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { io, Socket } from 'socket.io-client';
import { apiGetMe, apiGetSystemSettings, apiLogin, apiLogoutServer, apiRegister, apiUpdatePushToken, apiVerifyLoginOtp, BASE_URL, deleteRefreshToken, deleteToken, getToken, saveRefreshToken, saveToken, setUnauthorizedHandler, User } from '../services/api';

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

        newSocket.on('connect', () => {
            console.log('🔗 WebSocket connecté, enregistrement:', user.phone);
            newSocket.emit('register', user.phone);
        });

        newSocket.on('payment_received', (data: { amount: number, from: string }) => {
            Alert.alert(
                '💰 Paiement Reçu !',
                `Vous venez de recevoir ${data.amount.toLocaleString('fr-FR')} FCFA depuis ${data.from}.`,
                [{ text: 'Super !' }]
            );
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
                apiUpdatePushToken(token).catch(() => {});
            }
        });

        return () => {
            newSocket.disconnect();
        };
    }, [user?.phone]); // On re-connecte si le tel change

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

    return (
        <AuthContext.Provider value={{ user, token, isLoading, login, verifyLoginOtp, register, logout, setUser, settings }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth doit être utilisé dans un AuthProvider');
    return ctx;
};
