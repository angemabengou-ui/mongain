import React, { createContext, useContext, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { io, Socket } from 'socket.io-client';
import { apiGetMe, apiLogin, apiRegister, apiUpdatePushToken, BASE_URL, deleteToken, getToken, saveToken, setUnauthorizedHandler, User } from '../services/api';

async function registerForPushNotificationsAsync() {
    // Push notifications are temporarily disabled for stability (requires google-services.json)
    return null;
}

interface AuthContextType {
    user: User | null;
    token: string | null;
    isLoading: boolean;
    login: (phone: string, pin: string) => Promise<void>;
    register: (name: string, phone: string, pin: string, otpCode: string) => Promise<void>;
    logout: () => Promise<void>;
    setUser: (user: User | null) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [token, setToken] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [socket, setSocket] = useState<Socket | null>(null);

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
                apiUpdatePushToken(token).catch(e => console.error('Erreur API sauver token', e));
            }
        });

        return () => {
            newSocket.disconnect();
        };
    }, [user?.phone]); // On re-connecte si le tel change

    const logout = async () => {
        await deleteToken();
        setToken(null);
        setUser(null);
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
        const { token: newToken, user: newUser } = await apiLogin(phone, pin);
        await saveToken(newToken);
        setToken(newToken);
        setUser(newUser);
    };

    const register = async (name: string, phone: string, pin: string, otpCode: string) => {
        const { token: newToken, user: newUser } = await apiRegister(name, phone, pin, otpCode);
        await saveToken(newToken);
        setToken(newToken);
        setUser(newUser);
    };

    return (
        <AuthContext.Provider value={{ user, token, isLoading, login, register, logout, setUser }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth doit être utilisé dans un AuthProvider');
    return ctx;
};
