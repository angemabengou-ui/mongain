import { Activity, Banknote, ChevronDown, ChevronRight, LayoutDashboard, LogOut, MessageSquare, Server, Settings as SettingsIcon, Shield, ShieldAlert, ShieldCheck, ShoppingBag, Store, Users as UsersIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import Accounts from './Accounts';
import AgencyCenter from './AgencyCenter';
import AuditLogs from './AuditLogs';
import BranchDashboard from './BranchDashboard';
import ChangePassword from './ChangePassword';
import GlobalSearch from './components/GlobalSearch';
import { API_URL } from './config';
import Dashboard from './Dashboard';
import ErrorLogs from './ErrorLogs';
import KycMod from './KycMod';
import Ledger from './Ledger';
import Login from './Login';
import MacroStats from './MacroStats';
import Merchants from './Merchants';
import Settings from './Settings';
import SupportCenter from './SupportCenter';
import SystemAccounts from './SystemAccounts';
import TellerTerminal from './TellerTerminal';
import Tontines from './Tontines';
import Treasury from './Treasury';
import Users from './Users';
import Vaults from './Vaults';

// Un groupe ou un item est visible si l'une des permissions listées est possédée par l'utilisateur (OR logic).
// Si le tableau est omis ou vide, l'accès est libre (ou géré par l'ancien système de hook global).
type NavGroup = {
  id: string,
  label: string,
  icon: any,
  reqPerms?: string[],
  items: { id: string, label: string, route?: string, reqPerms?: string[] }[]
};

export default function App() {
  const [token, setToken] = useState(sessionStorage.getItem('admin_token'));
  const [role, setRole] = useState(localStorage.getItem('admin_role') || 'ADMIN');
  const [userName, setUserName] = useState(localStorage.getItem('admin_name') || 'Admin');
  const [staffId, setStaffId] = useState(localStorage.getItem('admin_staff_id') || '');
  const [phone, setPhone] = useState(localStorage.getItem('admin_phone') || '');
  const [mustChangePassword, setMustChangePassword] = useState(localStorage.getItem('admin_must_change_pw') === '1');

  // NOUVEAU RBAC : Stocker les permissions granulaires.
  const [permissions, setPermissions] = useState<Set<string>>(new Set());
  const [permsLoaded, setPermsLoaded] = useState(false);

  const defaultTabForRole = (r: string) =>
    r === 'SUPPORT_MAKER' ? 'reclamations'
      : ['TELLER', 'BRANCH_MANAGER'].includes(r) ? 'teller-terminal'
        : 'dashboard';

  const [activeTab, setActiveTab] = useState(() => localStorage.getItem('admin_active_tab') || defaultTabForRole(role));
  const [expandedGroup, setExpandedGroup] = useState<string | null>(() => localStorage.getItem('admin_expanded_group') || 'control-center');
  const [searchTarget, setSearchTarget] = useState<{ tab: string; id: string } | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<{ walletId: string; name: string } | null>(null);

  useEffect(() => {
    localStorage.setItem('admin_active_tab', activeTab);
  }, [activeTab]);

  useEffect(() => {
    if (expandedGroup) localStorage.setItem('admin_expanded_group', expandedGroup);
    else localStorage.removeItem('admin_expanded_group');
  }, [expandedGroup]);

  const logout = () => {
    sessionStorage.removeItem('admin_token');
    localStorage.clear(); // Clean up safely
    setToken(null);
  };

  useEffect(() => {
    if (token) {
      // Exécuter l'authentification standard (corp/me) + la matrice RBAC (/rbac/me) en parallèle
      Promise.all([
        fetch(API_URL + '/api/corp/me', { headers: { Authorization: `Bearer ${token}` } }).then(async r => {
          if (!r.ok) throw new Error('Revoked corp/me');
          return r.json();
        }),
        fetch(API_URL + '/api/admin/rbac/me', { headers: { Authorization: `Bearer ${token}` } }).then(async r => {
          if (!r.ok) throw new Error('Revoked rbac/me');
          return r.json();
        })
      ])
        .then(([corpData, rbacData]) => {
          if (corpData && typeof corpData.mustChangePassword === 'boolean') {
            setMustChangePassword(corpData.mustChangePassword);
            localStorage.setItem('admin_must_change_pw', corpData.mustChangePassword ? '1' : '0');
          }
          if (corpData && corpData.id) {
            setStaffId(corpData.id);
            localStorage.setItem('admin_staff_id', corpData.id);
          }
          // Injection des permissions dans le State
          if (rbacData && rbacData.permissions) {
            setPermissions(new Set(rbacData.permissions));
          }
          setPermsLoaded(true);
        })
        .catch(err => {
          console.error(err);
          logout();
        });
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

  if (!permsLoaded) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-primary)', color: 'var(--text-muted)' }}>Initialisation de vos droits d'accès...</div>;

  // Fonction utilitaire pour vérifier si l'utilisateur possède au moins UNE des permissions requises
  const hasPerm = (reqPerms?: string[]) => {
    if (!reqPerms || reqPerms.length === 0) return true; // Libre accès si pas de req spécifiée
    return reqPerms.some(p => permissions.has(p));
  };

  // NOUVELLE CARTE DE NAVIGATION (Couplée au RBAC)
  const SIDEBAR_GROUPS: NavGroup[] = [
    {
      id: 'control-center', label: 'TABLEAU DE BORD', icon: <LayoutDashboard size={18} />,
      reqPerms: ['perm_analytics_view'],
      items: [
        { id: 'dashboard', label: 'Vue Globale', reqPerms: ['perm_analytics_view'] },
        { id: 'macro-stats', label: 'Analytique Globale', reqPerms: ['perm_analytics_view'] }
      ]
    },
    {
      id: 'comptes', label: 'COMPTES', icon: <UsersIcon size={18} />,
      reqPerms: ['perm_customer_view', 'perm_staff_view'],
      items: [{ id: 'accounts', label: 'Clients, Personnel & Agences', reqPerms: ['perm_customer_view', 'perm_staff_view'] }]
    },
    {
      id: 'system-finance', label: 'COMPTES SYSTÈME', icon: <Server size={18} />,
      reqPerms: ['perm_treasury_view'],
      items: [{ id: 'system-accounts', label: 'Comptes Techniques & Réserves', reqPerms: ['perm_treasury_view'] }]
    },
    {
      id: 'clients-comptes', label: 'PRODUITS COLLECTIFS', icon: <Shield size={18} />,
      reqPerms: ['perm_vault_view', 'perm_tontine_view'],
      items: [
        { id: 'vaults', label: 'Caisses Communes', reqPerms: ['perm_vault_view'] },
        { id: 'tontines', label: 'Tontines', reqPerms: ['perm_tontine_view'] }
      ]
    },
    {
      id: 'marchands', label: 'MARCHANDS', icon: <ShoppingBag size={18} />,
      reqPerms: ['perm_merchant_view'],
      items: [{ id: 'merchants', label: 'Comptes Marchands', reqPerms: ['perm_merchant_view'] }]
    },
    {
      id: 'ops-agence', label: 'GUICHET & AGENCE', icon: <Store size={18} />,
      reqPerms: ['perm_branch_view', 'perm_branch_manage', 'perm_cash_session_open', 'perm_cash_in', 'perm_cash_out'],
      items: [
        { id: 'branch-dash', label: 'Supervision Agence', reqPerms: ['perm_branch_view'] },
        { id: 'teller-terminal', label: 'Opérations Guichet (Caisse)', reqPerms: ['perm_cash_session_open', 'perm_cash_in', 'perm_cash_out'] },
        { id: 'agency-center', label: 'Réseau d\'Agences', reqPerms: ['perm_branch_manage'] }
      ]
    },
    {
      id: 'transactions', label: 'TRANSACTIONS & FINANCE', icon: <Activity size={18} />,
      reqPerms: ['perm_transaction_view'],
      items: [{ id: 'ledger', label: 'Grand Livre (Ledger)', reqPerms: ['perm_transaction_view'] }]
    },
    {
      // Régression : COMPLIANCE_CHECKER n'a que perm_treasury_approve (RBAC.ts) — sans
      // l'inclure ici, le Checker ne voyait jamais l'onglet Trésorerie où vivent
      // Valider/Rejeter, alors que le backend l'autorise déjà pleinement à approuver.
      id: 'tresorerie', label: 'TRÉSORERIE', icon: <Banknote size={18} />,
      reqPerms: ['perm_treasury_view', 'perm_treasury_mint', 'perm_treasury_approve'],
      items: [{ id: 'treasury', label: 'Réserve & Injection Liquidité', reqPerms: ['perm_treasury_view', 'perm_treasury_mint', 'perm_treasury_approve'] }]
    },
    {
      id: 'risque', label: 'RISQUE & CONFORMITÉ', icon: <ShieldAlert size={18} />,
      reqPerms: ['perm_customer_kyc_view', 'perm_customer_kyc_validate', 'perm_customer_flag'],
      items: [
        { id: 'kyc', label: 'Dossiers KYC / AML', reqPerms: ['perm_customer_kyc_view', 'perm_customer_kyc_validate'] }
      ]
    },
    {
      // COMPLIANCE_CHECKER n'a que perm_ticket_resolve (pas ticket_view/support_note) — sans
      // l'inclure, le Checker ne voyait jamais cette section alors qu'il peut résoudre des tickets.
      id: 'litiges', label: 'LITIGES & SUPPORT', icon: <MessageSquare size={18} />,
      reqPerms: ['perm_ticket_view', 'perm_support_note', 'perm_ticket_resolve'],
      items: [{ id: 'reclamations', label: 'Support & Réclamations', reqPerms: ['perm_ticket_view', 'perm_ticket_resolve'] }]
    },
    {
      // Même correctif que Trésorerie ci-dessus : COMPLIANCE_CHECKER n'a que
      // perm_system_settings_approve, jamais _view, pour la file d'approbation Checker.
      id: 'platform', label: 'PARAMÈTRES SYSTÈME', icon: <SettingsIcon size={18} />,
      reqPerms: ['perm_system_settings_view', 'perm_system_settings_approve'],
      items: [{ id: 'settings', label: 'Configuration & API', reqPerms: ['perm_system_settings_view', 'perm_system_settings_approve'] }]
    },
    {
      id: 'securite', label: 'SÉCURITÉ', icon: <ShieldCheck size={18} />,
      reqPerms: ['perm_audit_log_view'],
      items: [
        { id: 'audit', label: 'Centre d\'Audit', reqPerms: ['perm_audit_log_view'] },
        { id: 'error-logs', label: 'Erreurs P0 & Exceptions', reqPerms: ['perm_audit_log_view'] }
      ]
    }
  ];

  const ROLE_LABELS: Record<string, string> = {
    SUPER_ADMIN: 'Super Administrateur', RISK: 'Analyste Risque',
    COMPLIANCE_CHECKER: 'Conformité', SUPPORT_MAKER: 'Support Client', BRANCH_MANAGER: 'Responsable d\'Agence',
    TELLER: 'Caissier'
  };

  const TAB_LABELS: Record<string, string> = {
    'users': 'Portraits Client (360)',
    ...Object.fromEntries(SIDEBAR_GROUPS.flatMap(g => g.items.map(i => [i.id, i.label])))
  };

  const toggleGroup = (id: string) => {
    setExpandedGroup(expandedGroup === id ? null : id);
  };

  const handleNav = (tabId: string, route?: string) => {
    setActiveTab(route || tabId);
  };

  // Fonction pour filtrer récursivement les groupes/items que l'Auteur a le droit de voir
  const getAuthorizedSidebar = () => {
    return SIDEBAR_GROUPS.map(group => {
      if (!hasPerm(group.reqPerms)) return null;
      const validItems = group.items.filter(item => hasPerm(item.reqPerms));
      if (validItems.length === 0) return null;
      return { ...group, items: validItems };
    }).filter(g => g !== null) as NavGroup[];
  };

  const authorizedGroups = getAuthorizedSidebar();

  return (
    <div className="app-container">
      <div className="sidebar" style={{ width: 320, padding: 0, gap: 0, display: 'flex', flexDirection: 'column' }}>
        <div className="sidebar-logo" style={{ padding: '32px 24px' }}>
          <div className="logo-icon">M.</div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span>Mongain</span>
            <span style={{ fontSize: 11, color: 'var(--sidebar-text)', fontWeight: 500, letterSpacing: 0.5 }}>PORTAIL ÉQUIPE & OPÉRATIONS</span>
          </div>
        </div>

        <div className="nav-links" style={{ flex: 1, overflowY: 'auto', padding: '0 16px 32px' }}>

          {/* C-360 et Recherche Rapide : Menu Fixe Accessible si Support ou Permis */}
          {hasPerm(['perm_customer_360_basic']) && (
            <div className="nav-divider" style={{ margin: '10px 0 20px', borderTop: '1px solid rgba(255,255,255,0.05)' }}></div>
          )}

          {authorizedGroups.map(group => (
            group.items.length === 1 ? (
              <div
                key={group.id}
                className={`nav-item ${(activeTab === group.items[0].id || activeTab === group.items[0].route) ? 'active' : ''}`}
                onClick={() => handleNav(group.items[0].id, group.items[0].route)}
                style={{ marginBottom: 4 }}
              >
                {group.icon} {group.items[0].label}
              </div>
            ) : (
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
            )
          ))}

        </div>

        <div style={{ padding: '16px 24px', borderTop: '1px solid var(--sidebar-border)', background: 'rgba(0,0,0,0.2)' }}>
          <div className="nav-item" onClick={logout} style={{ color: '#E58D85', margin: 0, justifyContent: 'center', background: 'transparent' }}>
            <LogOut size={16} /> Déconnexion Manuelle
          </div>
        </div>
      </div>

      <div className="main-wrapper">
        <header className="topbar">
          <div className="breadcrumb">
            <span style={{ color: 'var(--text-muted)' }}>Workspace</span>
            <span style={{ color: 'var(--border)', margin: '0 8px' }}>/</span>
            <span style={{ color: 'var(--text-primary)', fontWeight: 600, textTransform: 'uppercase', fontSize: 13, letterSpacing: 0.5 }}>
              {TAB_LABELS[activeTab] || activeTab.replace(/-/g, ' ')}
            </span>
          </div>

          <div className="topbar-right">
            {hasPerm(['perm_customer_360_basic', 'perm_customer_view']) && (
              <GlobalSearch token={token} onNavigate={(tab, id) => { setActiveTab(tab); setSearchTarget({ tab, id }); }} />
            )}
            <div className="topbar-user">
              <div className="avatar">{userName.charAt(0).toUpperCase()}</div>
              <div>
                <div style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 14 }}>{userName}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }} title={phone}>{ROLE_LABELS[role] || role}</div>
              </div>
            </div>
          </div>
        </header>

        <main className="content-area">
          {/* PROTECTED ROUTES RENDERING (View gates based on explicitly validated permissions) */}
          {activeTab === 'dashboard' && hasPerm(['perm_analytics_view']) && <Dashboard />}
          {activeTab === 'macro-stats' && hasPerm(['perm_analytics_view']) && <MacroStats token={token} />}
          {activeTab === 'accounts' && hasPerm(['perm_customer_view', 'perm_staff_view']) && <Accounts token={token} role={role} hasPerm={hasPerm} />}

          {/* Les sous-pages Customer 360 se branchent ici. users est activé par accounts ou global search */}
          {activeTab === 'users' && hasPerm(['perm_customer_360_basic', 'perm_customer_view']) && <Users token={token} staffRole={role} hasPerm={hasPerm} initialSelectedUserId={searchTarget?.tab === 'users' ? searchTarget.id : undefined} />}
          {activeTab === 'vaults' && hasPerm(['perm_vault_view']) && <Vaults token={token} hasPerm={hasPerm} initialSelectedId={searchTarget?.tab === 'vaults' ? searchTarget.id : undefined} />}
          {activeTab === 'tontines' && hasPerm(['perm_tontine_view']) && <Tontines token={token} hasPerm={hasPerm} initialSelectedId={searchTarget?.tab === 'tontines' ? searchTarget.id : undefined} />}
          {activeTab === 'merchants' && hasPerm(['perm_merchant_view']) && <Merchants token={token} hasPerm={hasPerm} initialSelectedId={searchTarget?.tab === 'merchants' ? searchTarget.id : undefined} />}

          {activeTab === 'reclamations' && hasPerm(['perm_ticket_view', 'perm_ticket_resolve']) && <SupportCenter token={token} hasPerm={hasPerm} />}
          {activeTab === 'branch-dash' && hasPerm(['perm_branch_view']) && <BranchDashboard token={token} onNavigateToTreasury={hasPerm(['perm_treasury_view']) ? () => setActiveTab('treasury') : undefined} />}
          {activeTab === 'agency-center' && hasPerm(['perm_branch_manage']) && <AgencyCenter token={token} hasPerm={hasPerm} />}
          {activeTab === 'teller-terminal' && hasPerm(['perm_cash_session_open', 'perm_cash_in', 'perm_cash_out']) && <TellerTerminal token={token} userName={userName} />}

          {activeTab === 'kyc' && hasPerm(['perm_customer_kyc_view', 'perm_customer_kyc_validate']) && <KycMod token={token} />}
          {activeTab === 'ledger' && hasPerm(['perm_transaction_view']) && <Ledger token={token} hasPerm={hasPerm} />}
          {activeTab === 'treasury' && hasPerm(['perm_treasury_view', 'perm_treasury_mint', 'perm_treasury_approve']) && <Treasury token={token} prefillAdjustTarget={adjustTarget} hasPerm={hasPerm} staffId={staffId} />}
          {activeTab === 'system-accounts' && hasPerm(['perm_treasury_view']) && <SystemAccounts token={token} onAdjust={(walletId, name) => { setAdjustTarget({ walletId, name }); setActiveTab('treasury'); }} />}
          {activeTab === 'audit' && hasPerm(['perm_audit_log_view']) && <AuditLogs token={token} />}
          {activeTab === 'error-logs' && hasPerm(['perm_audit_log_view']) && <ErrorLogs token={token} />}
          {activeTab === 'settings' && hasPerm(['perm_system_settings_view', 'perm_system_settings_approve']) && <Settings token={token} hasPerm={hasPerm} staffId={staffId} />}

          {/* FALLBACK IF NOT AUTHORIZED TO VIEW TAB */}
          {![
            'dashboard', 'macro-stats', 'accounts', 'users', 'vaults', 'tontines',
            'merchants', 'reclamations', 'branch-dash', 'agency-center', 'teller-terminal', 'kyc', 'ledger',
            'treasury', 'system-accounts', 'audit', 'error-logs', 'settings'
          ].includes(activeTab) && (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Configuration demandée non disponible avec vos droits d'accès.</div>
            )}
        </main>
      </div>
    </div>
  );
}
