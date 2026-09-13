import { BarChart3, Banknote, LayoutDashboard, Landmark, LogOut, UserCog, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiRequest, clearSession, ENDPOINTS, getStoredUser, getToken, type PortalUser } from './api';
import Affiliations from './Affiliations';
import AgencyWithdrawal from './AgencyWithdrawal';
import Dashboard from './Dashboard';
import EmployeePayouts from './EmployeePayouts';
import Login from './Login';
import Reports from './Reports';
import Team from './Team';

type Tab = 'dashboard' | 'reports' | 'affiliations' | 'employee-payouts' | 'agency-withdrawal' | 'team';

// "Équipe" reste visible pour un membre VIEWER (lecture seule) — voir qui a accès au portail
// est utile même sans pouvoir le modifier ; Team.tsx masque lui-même ses actions d'écriture
// (inviter/changer de rôle/désactiver/supprimer) via isPortalViewer(), pas cet écran de nav.
const NAV: { id: Tab; label: string; icon: any }[] = [
    { id: 'dashboard', label: 'Tableau de Bord', icon: <LayoutDashboard size={18} /> },
    { id: 'reports', label: 'Rapports', icon: <BarChart3 size={18} /> },
    { id: 'affiliations', label: 'Affiliations', icon: <Users size={18} /> },
    { id: 'employee-payouts', label: 'Paiement Employés', icon: <Banknote size={18} /> },
    { id: 'agency-withdrawal', label: 'Retrait Agence', icon: <Landmark size={18} /> },
    { id: 'team', label: 'Équipe', icon: <UserCog size={18} /> },
];

export default function App() {
    const [token, setToken] = useState<string | null>(() => getToken());
    const [user, setUser] = useState<PortalUser | null>(() => getStoredUser());
    const [activeTab, setActiveTab] = useState<Tab>('dashboard');
    const [loggingOut, setLoggingOut] = useState(false);

    // Si le rafraîchissement de session échoue au fond d'un écran quelconque (voir
    // api.ts::apiRequest), clearSession() émet cet évènement — on renvoie alors immédiatement
    // vers l'écran de connexion sans attendre une action manuelle de l'utilisateur.
    useEffect(() => {
        const handler = () => {
            setToken(null);
            setUser(null);
            setActiveTab('dashboard');
        };
        window.addEventListener('merchant-portal-session-cleared', handler);
        return () => window.removeEventListener('merchant-portal-session-cleared', handler);
    }, []);

    const handleLogin = (loggedInUser: PortalUser) => {
        setUser(loggedInUser);
        setToken(getToken());
        setActiveTab('dashboard');
    };

    const handleSessionExpired = () => {
        // clearSession() a déjà été appelé par api.ts et a émis l'évènement écouté ci-dessus ;
        // on force quand même l'état local immédiatement pour un retour instantané à l'écran de
        // connexion depuis l'écran qui a détecté l'expiration.
        setToken(null);
        setUser(null);
    };

    const handleLogout = async () => {
        if (loggingOut) return;
        setLoggingOut(true);
        try {
            await apiRequest(ENDPOINTS.logout, { method: 'POST' });
        } catch {
            // La déconnexion locale doit réussir même si l'appel réseau échoue (serveur injoignable,
            // token déjà expiré...) — on ne bloque jamais l'utilisateur sur cet écran.
        } finally {
            clearSession();
            setToken(null);
            setUser(null);
            setLoggingOut(false);
        }
    };

    if (!token) return <Login onLogin={handleLogin} />;

    const displayName = user?.businessName || user?.name || 'Marchand';

    return (
        <div className="app-container">
            <div className="sidebar" style={{ padding: 0 }}>
                <div className="sidebar-logo" style={{ padding: '28px 24px' }}>
                    <img src="/favicon.svg" style={{ width: 36, height: 36, borderRadius: 10 }} alt="Mongain" />
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span>Mongain</span>
                        <span style={{ fontSize: 11, color: 'var(--sidebar-text)', fontWeight: 500, letterSpacing: 0.5 }}>PORTAIL MARCHAND GÉANT</span>
                    </div>
                </div>

                <div className="nav-links" style={{ flex: 1, padding: '0 16px' }}>
                    {NAV.map(item => (
                        <div
                            key={item.id}
                            className={`nav-item ${activeTab === item.id ? 'active' : ''}`}
                            onClick={() => setActiveTab(item.id)}
                        >
                            {item.icon} {item.label}
                        </div>
                    ))}
                </div>

                <div style={{ padding: '16px 24px', borderTop: '1px solid var(--sidebar-border)', background: 'rgba(0,0,0,0.2)' }}>
                    <div className="nav-item" onClick={handleLogout} style={{ color: '#E58D85', margin: 0, justifyContent: 'center', background: 'transparent', opacity: loggingOut ? 0.6 : 1, cursor: loggingOut ? 'not-allowed' : 'pointer' }}>
                        <LogOut size={16} /> {loggingOut ? 'Déconnexion...' : 'Déconnexion'}
                    </div>
                </div>
            </div>

            <div className="main-wrapper">
                <header className="topbar">
                    <div className="breadcrumb">
                        <span style={{ color: 'var(--text-muted)' }}>Portail</span>
                        <span style={{ color: 'var(--border)', margin: '0 8px' }}>/</span>
                        <span style={{ color: 'var(--text-primary)', fontWeight: 600, textTransform: 'uppercase', fontSize: 13, letterSpacing: 0.5 }}>
                            {NAV.find(n => n.id === activeTab)?.label || activeTab}
                        </span>
                    </div>
                    <div className="topbar-right">
                        <div className="topbar-user">
                            <div className="avatar">{displayName.charAt(0).toUpperCase()}</div>
                            <div>
                                <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 14 }}>{displayName}</div>
                                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{user?.phone || ''}</div>
                            </div>
                        </div>
                    </div>
                </header>

                <main className="content-area">
                    {activeTab === 'dashboard' && <Dashboard onSessionExpired={handleSessionExpired} />}
                    {activeTab === 'reports' && <Reports onSessionExpired={handleSessionExpired} />}
                    {activeTab === 'affiliations' && <Affiliations onSessionExpired={handleSessionExpired} />}
                    {activeTab === 'employee-payouts' && <EmployeePayouts onSessionExpired={handleSessionExpired} />}
                    {activeTab === 'agency-withdrawal' && <AgencyWithdrawal onSessionExpired={handleSessionExpired} />}
                    {activeTab === 'team' && <Team onSessionExpired={handleSessionExpired} />}
                </main>
            </div>
        </div>
    );
}
