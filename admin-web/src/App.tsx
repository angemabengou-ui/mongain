import { Activity, BadgeCheck, Banknote, LayoutDashboard, LogOut, MessageSquare, Settings as SettingsIcon, Store, Users as UsersIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import Agency from './Agency';
import AuditLogs from './AuditLogs';
import Dashboard from './Dashboard';
import KycMod from './KycMod';
import Ledger from './Ledger';
import Login from './Login';
import Reclamations from './Reclamations';
import Settings from './Settings';
import Treasury from './Treasury';
import Users from './Users';
import { API_URL } from './config';

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('admin_token'));
  const [role, setRole] = useState(localStorage.getItem('admin_role') || 'ADMIN');
  const [userName, setUserName] = useState(localStorage.getItem('admin_name') || 'Admin');
  const [phone, setPhone] = useState(localStorage.getItem('admin_phone') || '');

  const [activeTab, setActiveTab] = useState(role === 'AGENT' ? 'agency' : 'dashboard');

  const logout = () => {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_role');
    localStorage.removeItem('admin_name');
    localStorage.removeItem('admin_phone');
    setToken(null);
  };

  useEffect(() => {
    if (token) {
      fetch(API_URL + '/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
        .then(res => {
          if (res.status === 401 || res.status === 403) logout();
        })
        .catch(console.error);
    }
  }, [token]);

  if (!token) return <Login setToken={(t, r, n, p) => {
    localStorage.setItem('admin_token', t);
    localStorage.setItem('admin_role', r);
    localStorage.setItem('admin_name', n);
    localStorage.setItem('admin_phone', p);
    setRole(r);
    setUserName(n);
    setPhone(p);
    setActiveTab(r === 'AGENT' ? 'agency' : 'dashboard');
    setToken(t);
  }} />;

  const isSuperAdmin = role === 'ADMIN';

  return (
    <div className="app-container">
      <div className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-icon">M.</div>
          Mongain {isSuperAdmin ? 'Admin' : 'Agency'}
        </div>
        <div className="nav-links">
          {role === 'AGENT' && (
            <div className={`nav-item ${activeTab === 'agency' ? 'active' : ''}`} onClick={() => setActiveTab('agency')}>
              <Store size={20} /> Guichet (Cash)
            </div>
          )}

          {isSuperAdmin && (
            <>
              <div className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}>
                <LayoutDashboard size={20} /> Vue globale
              </div>
              <div className={`nav-item ${activeTab === 'users' ? 'active' : ''}`} onClick={() => setActiveTab('users')}>
                <UsersIcon size={20} /> Utilisateurs
              </div>
              <div className={`nav-item ${activeTab === 'kyc' ? 'active' : ''}`} onClick={() => setActiveTab('kyc')}>
                <BadgeCheck size={20} /> Dossiers KYC
              </div>
              <div className={`nav-item ${activeTab === 'treasury' ? 'active' : ''}`} onClick={() => setActiveTab('treasury')}>
                <Banknote size={20} /> Trésorerie
              </div>
              <div className={`nav-item ${activeTab === 'ledger' ? 'active' : ''}`} onClick={() => setActiveTab('ledger')}>
                <Activity size={20} /> Grand Livre (Ledger)
              </div>
              <div className={`nav-item ${activeTab === 'reclamations' ? 'active' : ''}`} onClick={() => setActiveTab('reclamations')}>
                <MessageSquare size={20} /> Réclamations
              </div>
              <div className={`nav-item ${activeTab === 'audit' ? 'active' : ''}`} onClick={() => setActiveTab('audit')}>
                <Activity size={20} /> Centre d'Audit
              </div>
              <div className="nav-divider"></div>
              <div className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')}>
                <SettingsIcon size={20} /> Paramètres Frais
              </div>
            </>
          )}
        </div>
        <div style={{ marginTop: 'auto' }}>
          <div className="nav-item" onClick={logout} style={{ color: 'var(--danger)' }}>
            <LogOut size={20} /> Déconnexion
          </div>
        </div>
      </div>

      <div className="main-content">
        <div className="header">
          <h1>
            {activeTab === 'agency' ? 'Guichet Bancaire' :
              activeTab === 'dashboard' ? 'Vue Globale' :
                activeTab === 'treasury' ? 'Gestion Trésorerie' :
                  activeTab === 'audit' ? 'Audit et Sécurité' :
                    activeTab === 'users' ? 'Utilisateurs' :
                      activeTab === 'kyc' ? 'Vérification d\'Identité' :
                        activeTab === 'ledger' ? 'Grand Livre (AML)' :
                          activeTab === 'settings' ? 'Paramètres' : 'Réclamations'}
          </h1>
          <div className="profile-badge">
            <div className="profile-avatar">{userName.charAt(0).toUpperCase()}</div>
            <span>{isSuperAdmin ? 'Super Admin' : 'Agent'}</span>
          </div>
        </div>

        {activeTab === 'agency' && <Agency token={token} agentPhone={phone} agentName={userName} />}
        {activeTab === 'dashboard' && isSuperAdmin && <Dashboard token={token} />}
        {activeTab === 'users' && isSuperAdmin && <Users token={token} />}
        {activeTab === 'kyc' && isSuperAdmin && <KycMod token={token} />}
        {activeTab === 'ledger' && isSuperAdmin && <Ledger token={token} />}
        {activeTab === 'reclamations' && isSuperAdmin && <Reclamations token={token} />}
        {activeTab === 'treasury' && isSuperAdmin && <Treasury token={token} />}
        {activeTab === 'audit' && isSuperAdmin && <AuditLogs token={token} />}
        {activeTab === 'settings' && isSuperAdmin && <Settings token={token} />}
      </div>
    </div>
  );
}
