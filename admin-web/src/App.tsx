import { Activity, BadgeCheck, Banknote, Briefcase, LayoutDashboard, LogOut, MessageSquare, Settings as SettingsIcon, Store, Users as UsersIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import Agency from './Agency';
import AuditLogs from './AuditLogs';
import Branches from './Branches';
import { API_URL } from './config';
import Dashboard from './Dashboard';
import KycMod from './KycMod';
import Ledger from './Ledger';
import Login from './Login';
import MerchantDashboard from './MerchantDashboard';
import Reclamations from './Reclamations';
import Settings from './Settings';
import StaffCRM from './StaffCRM';
import TellerTerminal from './TellerTerminal';
import Treasury from './Treasury';
import Users from './Users';

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('admin_token'));
  const [role, setRole] = useState(localStorage.getItem('admin_role') || 'ADMIN');
  const [userName, setUserName] = useState(localStorage.getItem('admin_name') || 'Admin');
  const [phone, setPhone] = useState(localStorage.getItem('admin_phone') || '');

  const isBranchOps = ['TELLER', 'BRANCH_MANAGER', 'SUPER_ADMIN'].includes(role);
  const isSuperAdmin = ['ADMIN', 'SUPER_ADMIN', 'RISK', 'COMPLIANCE_CHECKER'].includes(role);

  const [activeTab, setActiveTab] = useState(
    role === 'MERCHANT' ? 'merchant-dash'
      : role === 'AGENT' ? 'agency'
        : ['TELLER', 'BRANCH_MANAGER'].includes(role) ? 'teller-terminal'
          : 'dashboard'
  );

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
    setActiveTab(r === 'MERCHANT' ? 'merchant-dash' : r === 'AGENT' ? 'agency' : ['TELLER', 'BRANCH_MANAGER'].includes(role) ? 'teller-terminal' : 'dashboard');
    setToken(t);
  }} />;

  return (
    <div className="app-container">
      <div className="sidebar">
        <div className="sidebar-logo">
          <div className="logo-icon">M.</div>
          Mongain {isSuperAdmin ? 'Admin' : role === 'MERCHANT' ? 'Marchand' : 'Agency'}
        </div>
        <div className="nav-links">
          {role === 'AGENT' && (
            <div className={`nav-item ${activeTab === 'agency' ? 'active' : ''}`} onClick={() => setActiveTab('agency')}>
              <Store size={20} /> Guichet (Cash)
            </div>
          )}

          {role === 'MERCHANT' && (
            <div className={`nav-item ${activeTab === 'merchant-dash' ? 'active' : ''}`} onClick={() => setActiveTab('merchant-dash')}>
              <Store size={20} /> Ventes & Encaissements
            </div>
          )}

          {isBranchOps && (
            <div className={`nav-item ${activeTab === 'teller-terminal' ? 'active' : ''}`} onClick={() => setActiveTab('teller-terminal')}>
              <Store size={20} /> Guichet (Agence Locale)
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
              <div className={`nav-item ${activeTab === 'staff' ? 'active' : ''}`} onClick={() => setActiveTab('staff')}>
                <Briefcase size={20} /> Personnel (HQ)
              </div>
              <div className={`nav-item ${activeTab === 'branches' ? 'active' : ''}`} onClick={() => setActiveTab('branches')}>
                <Store size={20} /> Réseau d'Agences
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
      <div className="main-wrapper">
        <header className="topbar">
          <div className="breadcrumb">
            <span style={{ color: 'var(--text-muted)' }}>M. Corporate</span>
            <span style={{ color: 'var(--border)', margin: '0 8px' }}>/</span>
            <span style={{ color: 'var(--text-primary)', fontWeight: 600, textTransform: 'capitalize' }}>
              {activeTab === 'users' ? 'CRM Utilisateurs' : activeTab === 'staff' ? 'Habilitations' : activeTab === 'branches' ? 'Gestion Réseau' : activeTab === 'kyc' ? 'Base Identité' : activeTab === 'ledger' ? 'Grand Livre' : activeTab}
            </span>
          </div>

          <div className="topbar-right">
            <div className="topbar-user">
              <div className="avatar">{userName.charAt(0).toUpperCase()}</div>
              <div>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{userName}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{isSuperAdmin ? 'National Manager' : role}</div>
              </div>
            </div>
          </div>
        </header>

        <main className="content-area">
          {activeTab === 'agency' && <Agency token={token} agentPhone={phone} agentName={userName} />}
          {activeTab === 'merchant-dash' && role === 'MERCHANT' && <MerchantDashboard token={token} />}
          {activeTab === 'teller-terminal' && isBranchOps && <TellerTerminal token={token} />}
          {activeTab === 'dashboard' && isSuperAdmin && <Dashboard token={token} />}
          {activeTab === 'users' && isSuperAdmin && <Users token={token} />}
          {activeTab === 'staff' && isSuperAdmin && <StaffCRM token={token} />}
          {activeTab === 'branches' && isSuperAdmin && <Branches token={token} />}
          {activeTab === 'kyc' && isSuperAdmin && <KycMod token={token} />}
          {activeTab === 'ledger' && isSuperAdmin && <Ledger token={token} />}
          {activeTab === 'reclamations' && isSuperAdmin && <Reclamations token={token} />}
          {activeTab === 'treasury' && isSuperAdmin && <Treasury token={token} />}
          {activeTab === 'audit' && isSuperAdmin && <AuditLogs token={token} />}
          {activeTab === 'settings' && isSuperAdmin && <Settings token={token} />}
        </main>
      </div>
    </div>
  );
}
