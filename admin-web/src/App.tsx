import { Activity, Banknote, Building2, ChevronDown, ChevronRight, LayoutDashboard, LogOut, MessageSquare, Settings as SettingsIcon, ShieldAlert, ShieldCheck, Store, Users as UsersIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import AgencyCenter from './AgencyCenter';
import AuditLogs from './AuditLogs';
import BranchDashboard from './BranchDashboard';
import ChangePassword from './ChangePassword';
import { API_URL } from './config';
import Dashboard from './Dashboard';
import ErrorLogs from './ErrorLogs';
import KycMod from './KycMod';
import Ledger from './Ledger';
import Login from './Login';
import MacroStats from './MacroStats';
import Settings from './Settings';
import StaffAccessRights from './StaffAccessRights';
import StaffAssignBranch from './StaffAssignBranch';
import StaffCreate from './StaffCreate';
import SupportCenter from './SupportCenter';
import TellerTerminal from './TellerTerminal';
import Treasury from './Treasury';
import Users from './Users';
import Vaults from './Vaults';

export default function App() {
  // VUL-05 : Le token JWT est migré vers sessionStorage au lieu de localStorage.
  // sessionStorage : scopé par onglet/session — disparait à la fermeture du tab,
  // et inaccessible aux scripts d'autres origines (XSS cross-origin réduit).
  // Les données non-sensibles (rôle, préférences UI) restent en localStorage.
  const [token, setToken] = useState(sessionStorage.getItem('admin_token'));
  const [role, setRole] = useState(localStorage.getItem('admin_role') || 'ADMIN');
  const [userName, setUserName] = useState(localStorage.getItem('admin_name') || 'Admin');
  const [phone, setPhone] = useState(localStorage.getItem('admin_phone') || '');
  const [mustChangePassword, setMustChangePassword] = useState(localStorage.getItem('admin_must_change_pw') === '1');

  const isBranchOps = ['TELLER', 'BRANCH_MANAGER'].includes(role) || ['ADMIN', 'SUPER_ADMIN'].includes(role);
  const isSuperAdmin = ['ADMIN', 'SUPER_ADMIN', 'RISK', 'COMPLIANCE_CHECKER'].includes(role);
  // SUPPORT_MAKER : accès Support/Réclamations & Customer 360 uniquement (voir SUPPORT_ROLES / CRM_FULL_ACCESS côté backend admin.ts)
  const isSupportRole = role === 'SUPPORT_MAKER';

  const defaultTabForRole = (r: string) =>
    r === 'SUPPORT_MAKER' ? 'reclamations'
      : ['TELLER', 'BRANCH_MANAGER'].includes(r) ? 'branch-dash'
        : 'dashboard';

  // Reste sur la page active après un rafraîchissement (F5) au lieu de revenir au tableau de bord.
  const [activeTab, setActiveTab] = useState(() => localStorage.getItem('admin_active_tab') || defaultTabForRole(role));
  const [expandedGroup, setExpandedGroup] = useState<string | null>(() => localStorage.getItem('admin_expanded_group') || 'control-center');

  useEffect(() => {
    localStorage.setItem('admin_active_tab', activeTab);
  }, [activeTab]);

  useEffect(() => {
    if (expandedGroup) localStorage.setItem('admin_expanded_group', expandedGroup);
    else localStorage.removeItem('admin_expanded_group');
  }, [expandedGroup]);

  const logout = () => {
    sessionStorage.removeItem('admin_token');
    localStorage.removeItem('admin_role');
    localStorage.removeItem('admin_name');
    localStorage.removeItem('admin_phone');
    localStorage.removeItem('admin_must_change_pw');
    localStorage.removeItem('admin_active_tab');
    localStorage.removeItem('admin_expanded_group');
    setToken(null);
  };

  useEffect(() => {
    if (token) {
      // /api/auth/me ne cherche que dans la table User (B2C) : pour un token Staff
      // (portail corporate), il renvoie systématiquement 404, jamais 401/403, donc
      // la révocation de session n'était jamais détectée par cet appel.
      fetch(API_URL + '/api/corp/me', { headers: { Authorization: `Bearer ${token}` } })
        .then(res => {
          if (res.status === 401 || res.status === 403 || res.status === 404) { logout(); return; }
          return res.json();
        })
        .then(data => {
          if (data && typeof data.mustChangePassword === 'boolean') {
            setMustChangePassword(data.mustChangePassword);
            localStorage.setItem('admin_must_change_pw', data.mustChangePassword ? '1' : '0');
          }
        })
        .catch(console.error);
    }
  }, [token]);

  if (!token) return <Login setToken={(t, r, n, p, mcp) => {
    sessionStorage.setItem('admin_token', t);
    localStorage.setItem('admin_role', r);
    localStorage.setItem('admin_name', n);
    localStorage.setItem('admin_phone', p);
    localStorage.setItem('admin_must_change_pw', mcp ? '1' : '0');
    setRole(r);
    setUserName(n);
    setPhone(p);
    setMustChangePassword(mcp);
    setActiveTab(defaultTabForRole(r));
    setToken(t);
  }} />;

  if (mustChangePassword) return <ChangePassword token={token} onLogout={logout} />;

  // Navigation Map — réorganisée pour éliminer les doublons : "Business" (Marchands &
  // Agents) et "Clients & Comptes" menaient tous deux au même écran Users.tsx (qui, côté
  // backend, ne pouvait de toute façon renvoyer que des clients — les agents/marchands en
  // étaient exclus). Users.tsx gère maintenant ces trois segments via un sélecteur interne,
  // donc un seul point d'entrée suffit. Même chose pour "Transactions" et "Finance", qui
  // pointaient tous deux vers le Grand Livre (Ledger). "Organisation" est explicitement
  // nommée "interne" pour la distinguer des comptes clients/agents/marchands ci-dessus.
  type NavGroup = { id: string, label: string, icon: any, roles: string[], items: { id: string, label: string, route?: string, roleExclude?: string[] }[] }; const SUPER_ADMIN_GROUPS: NavGroup[] = [
    {
      id: 'control-center', label: 'TABLEAU DE BORD', icon: <LayoutDashboard size={18} />, roles: ['SUPER_ADMIN', 'ADMIN', 'RISK', 'COMPLIANCE_CHECKER'],
      items: [
        { id: 'dashboard', label: 'Vue Globale' },
        { id: 'macro-stats', label: 'Analytique Globale' }
      ]
    },
    {
      id: 'clients-comptes', label: 'CLIENTS, AGENTS & MARCHANDS', icon: <UsersIcon size={18} />, roles: ['SUPER_ADMIN', 'ADMIN', 'RISK', 'COMPLIANCE_CHECKER'],
      items: [{ id: 'users', label: 'Base Clients (C-360)' }]
    },
    {
      id: 'transactions', label: 'TRANSACTIONS & FINANCE', icon: <Activity size={18} />, roles: ['SUPER_ADMIN', 'ADMIN', 'RISK', 'COMPLIANCE_CHECKER'],
      items: [{ id: 'ledger', label: 'Grand Livre (Ledger)' }]
    },
    {
      id: 'tresorerie', label: 'TRÉSORERIE', icon: <Banknote size={18} />, roles: ['SUPER_ADMIN', 'ADMIN', 'RISK', 'COMPLIANCE_CHECKER'],
      items: [{ id: 'treasury', label: 'Réserve & Liquidités du Siège' }]
    },
    {
      id: 'risque', label: 'RISQUE & CONFORMITÉ', icon: <ShieldAlert size={18} />, roles: ['SUPER_ADMIN', 'ADMIN', 'RISK', 'COMPLIANCE_CHECKER'],
      items: [
        { id: 'kyc', label: 'Dossiers KYC / AML' },
        { id: 'vaults', label: 'Caisses Communes' }
      ]
    },
    {
      id: 'litiges', label: 'LITIGES', icon: <MessageSquare size={18} />, roles: ['SUPER_ADMIN', 'ADMIN', 'RISK', 'COMPLIANCE_CHECKER'],
      items: [{ id: 'reclamations', label: 'Support & Réclamations' }]
    },
    {
      id: 'organisation', label: 'ORGANISATION INTERNE', icon: <Building2 size={18} />, roles: ['SUPER_ADMIN', 'ADMIN', 'RISK', 'COMPLIANCE_CHECKER'],
      // Onboarding du personnel volontairement éclaté en 3 pages distinctes (au lieu d'un
      // seul écran à modales) : créer l'identité, l'affecter à une agence, puis décider
      // ses droits — trois décisions séparées, jamais mélangées dans le même geste.
      items: [
        { id: 'staff-create', label: '1. Créer un Utilisateur' },
        { id: 'staff-assign', label: '2. Affecter à une Agence' },
        { id: 'staff-rights', label: "3. Droits d'Accès" },
        { id: 'branches', label: 'Centre des Agences' },
        // Ancien modèle d'agent (User.role='AGENT', sans rattachement à une agence) —
        // rattaché ici plutôt qu'à l'écran Clients, car un agent opère pour Mongain et
        // non comme client externe. Pour un nouvel agent avec les vrais droits
        // opérationnels (session de caisse, coffre physique), utiliser le parcours
        // "Créer un Utilisateur" ci-dessus (rôle TELLER, lié à une agence via branchId).
        { id: 'agents-legacy', label: 'Agents Mongain (ancien système)' }
      ]
    },
    {
      id: 'platform', label: 'PARAMÈTRES SYSTÈME', icon: <SettingsIcon size={18} />, roles: ['SUPER_ADMIN', 'ADMIN', 'RISK', 'COMPLIANCE_CHECKER'],
      items: [{ id: 'settings', label: 'Configuration & API' }]
    },
    {
      id: 'securite', label: 'SÉCURITÉ', icon: <ShieldCheck size={18} />, roles: ['SUPER_ADMIN', 'ADMIN', 'RISK', 'COMPLIANCE_CHECKER'],
      items: [
        { id: 'audit', label: 'Centre d\'Audit' },
        { id: 'error-logs', label: 'Erreurs Système' }
      ]
    }
  ];

  const ROLE_LABELS: Record<string, string> = {
    SUPER_ADMIN: 'Super Administrateur', ADMIN: 'Administrateur', RISK: 'Analyste Risque',
    COMPLIANCE_CHECKER: 'Conformité', SUPPORT_MAKER: 'Support Client', BRANCH_MANAGER: 'Responsable d\'Agence',
    TELLER: 'Caissier', MERCHANT: 'Marchand'
  };

  const BRANCH_GROUPS: NavGroup[] = [
    {
      id: 'ops-agence', label: 'GUICHET & AGENCE', icon: <Store size={18} />, roles: ['TELLER', 'BRANCH_MANAGER', 'SUPER_ADMIN', 'ADMIN'],
      items: [
        { id: 'branch-dash', label: 'Tableau de Bord Agence', roleExclude: ['TELLER'] },
        { id: 'teller-terminal', label: 'Opérations Guichet' }
      ].filter(i => !i.roleExclude?.includes(role))
    }
  ];

  // Utilisé par le fil d'Ariane pour afficher un intitulé lisible plutôt que l'id technique de l'onglet.
  const TAB_LABELS: Record<string, string> = {
    'merchant-dash': 'Ventes & Encaissements', 'reclamations': 'Support & Réclamations',
    ...Object.fromEntries(SUPER_ADMIN_GROUPS.flatMap(g => g.items.map(i => [i.id, i.label]))),
    ...Object.fromEntries(BRANCH_GROUPS.flatMap(g => g.items.map(i => [i.id, i.label])))
  };

  const toggleGroup = (id: string) => {
    setExpandedGroup(expandedGroup === id ? null : id);
  };

  const handleNav = (tabId: string, route?: string) => {
    setActiveTab(route || tabId);
  };

  return (
    <div className="app-container">
      <div className="sidebar" style={{ width: 300, padding: 0, gap: 0, display: 'flex', flexDirection: 'column' }}>
        <div className="sidebar-logo" style={{ padding: '32px 24px' }}>
          <div className="logo-icon">M.</div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span>Mongain</span>
            <span style={{ fontSize: 11, color: 'var(--sidebar-text)', fontWeight: 500, letterSpacing: 0.5 }}>PORTAIL D'ADMINISTRATION</span>
          </div>
        </div>

        <div className="nav-links" style={{ flex: 1, overflowY: 'auto', padding: '0 16px 32px' }}>

          {/* ── VUE GLOBALE – always pinned at top for admins ── */}
          {isSuperAdmin && (
            <>
              <div
                className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
                onClick={() => setActiveTab('dashboard')}
                style={{ fontWeight: 700, fontSize: 13, marginBottom: 4, padding: '10px 14px' }}
              >
                <LayoutDashboard size={17} /> Vue Globale
              </div>
              <div className="nav-divider" style={{ margin: '8px 0 12px' }} />
            </>
          )}

          {isSupportRole && (
            <>
              <div className={`nav-item ${activeTab === 'reclamations' ? 'active' : ''}`} onClick={() => handleNav('reclamations')} style={{ marginBottom: 4 }}>
                <MessageSquare size={18} /> Support & Réclamations
              </div>
              <div className={`nav-item ${activeTab === 'users' ? 'active' : ''}`} onClick={() => handleNav('users')} style={{ marginBottom: 4 }}>
                <UsersIcon size={18} /> Base Clients (C-360)
              </div>
              <div className={`nav-item ${activeTab === 'vaults' ? 'active' : ''}`} onClick={() => handleNav('vaults')} style={{ marginBottom: 8 }}>
                <ShieldCheck size={18} /> Caisses Communes
              </div>
            </>
          )}

          {/* MAIN SUPER ADMIN CONTROLS */}
          {isSuperAdmin && SUPER_ADMIN_GROUPS.filter(g => g.roles.includes(role)).map(group => (
            <div key={group.id} style={{ marginBottom: 4 }}>
              <div
                onClick={() => toggleGroup(group.id)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 14px', borderRadius: 8, cursor: 'pointer',
                  color: expandedGroup === group.id ? 'var(--sidebar-text-active)' : 'var(--sidebar-text)',
                  fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5,
                  background: expandedGroup === group.id ? 'var(--sidebar-hover)' : 'transparent'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ color: expandedGroup === group.id ? 'var(--accent-light)' : 'inherit' }}>{group.icon}</span>
                  {group.label}
                </div>
                {expandedGroup === group.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </div>

              {expandedGroup === group.id && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '4px 0 4px 28px' }}>
                  {group.items.map(item => (
                    <div
                      key={item.id}
                      className={`nav-item ${(activeTab === item.id || activeTab === item.route) ? 'active' : ''}`}
                      onClick={() => handleNav(item.id, item.route)}
                      style={{ padding: '8px 12px', fontSize: 13 }}
                    >
                      {item.label}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}

          {/* BRANCH OPS CONTROLS */}
          {isBranchOps && (
            <>
              {isSuperAdmin && <div className="nav-divider" style={{ margin: '24px 0' }}></div>}
              {BRANCH_GROUPS.filter(g => g.roles.includes(role)).map(group => (
                <div key={group.id} style={{ marginBottom: 4 }}>
                  <div
                    onClick={() => toggleGroup(group.id)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      padding: '12px 14px', borderRadius: 8, cursor: 'pointer',
                      color: expandedGroup === group.id ? 'var(--sidebar-text-active)' : 'var(--sidebar-text)',
                      fontWeight: 600, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5,
                      background: expandedGroup === group.id ? 'var(--sidebar-hover)' : 'transparent'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ color: expandedGroup === group.id ? 'var(--success)' : 'inherit' }}>{group.icon}</span>
                      {group.label}
                    </div>
                    {expandedGroup === group.id ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </div>

                  {expandedGroup === group.id && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '4px 0 4px 28px' }}>
                      {group.items.map(item => (
                        <div
                          key={item.id}
                          className={`nav-item ${(activeTab === item.id || activeTab === item.route) ? 'active' : ''}`}
                          onClick={() => handleNav(item.id, item.route)}
                          style={{ padding: '8px 12px', fontSize: 13 }}
                        >
                          {item.label}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}

        </div>

        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--sidebar-border)' }}>
          <div className="nav-item" onClick={logout} style={{ color: '#E58D85', margin: 0 }}>
            <LogOut size={20} /> Déconnexion
          </div>
        </div>
      </div>

      <div className="main-wrapper">
        <header className="topbar">
          <div className="breadcrumb">
            <span style={{ color: 'var(--text-muted)' }}>{isBranchOps && !isSuperAdmin ? 'Opérations' : 'Tableau de Bord'}</span>
            <span style={{ color: 'var(--border)', margin: '0 8px' }}>/</span>
            <span style={{ color: 'var(--text-primary)', fontWeight: 600, textTransform: 'uppercase', fontSize: 13, letterSpacing: 0.5 }}>
              {TAB_LABELS[activeTab] || activeTab.replace(/-/g, ' ')}
            </span>
          </div>

          <div className="topbar-right">
            <div className="topbar-user">
              <div className="avatar">{userName.charAt(0).toUpperCase()}</div>
              <div>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{userName}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }} title={phone}>{ROLE_LABELS[role] || role}</div>
              </div>
            </div>
          </div>
        </header>

        <main className="content-area">
          {activeTab === 'branch-dash' && isBranchOps && <BranchDashboard token={token} />}
          {activeTab === 'teller-terminal' && isBranchOps && <TellerTerminal token={token} userName={userName} />}

          {(isSuperAdmin || isSupportRole) && activeTab === 'users' && <Users token={token} staffRole={role} />}
          {(isSuperAdmin || isSupportRole) && activeTab === 'reclamations' && <SupportCenter token={token} role={role} />}

          {isSuperAdmin && (
            <>
              {activeTab === 'dashboard' && <Dashboard />}
              {activeTab === 'macro-stats' && <MacroStats token={token} />}
              {activeTab === 'staff-create' && <StaffCreate token={token} />}
              {activeTab === 'staff-assign' && <StaffAssignBranch token={token} />}
              {activeTab === 'staff-rights' && <StaffAccessRights token={token} />}
              {activeTab === 'branches' && <AgencyCenter token={token} role={role} />}
              {activeTab === 'agents-legacy' && <Users token={token} staffRole={role} lockedRole="AGENT" />}
              {activeTab === 'kyc' && <KycMod token={token} />}
              {activeTab === 'vaults' && <Vaults token={token} />}
              {activeTab === 'ledger' && <Ledger token={token} />}
              {activeTab === 'treasury' && <Treasury token={token} />}
              {activeTab === 'audit' && <AuditLogs token={token} />}
              {activeTab === 'error-logs' && <ErrorLogs token={token} />}
              {activeTab === 'settings' && <Settings token={token} />}
            </>
          )}
        </main>
      </div>
    </div>
  );
}


