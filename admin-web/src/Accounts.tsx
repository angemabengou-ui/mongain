import { Briefcase, Building2, Server, ShieldCheck, Users as UsersIcon } from 'lucide-react';
import { useState } from 'react';
import AgencyCenter from './AgencyCenter';
import TabBar from './components/TabBar';
import StaffAccessRights from './StaffAccessRights';
import StaffAssignBranch from './StaffAssignBranch';
import StaffCreate from './StaffCreate';
import SystemAccounts from './SystemAccounts';
import Users from './Users';

// Point d'entrée unique pour tout ce qui est un "compte" sur la plateforme — avant,
// il fallait deviner dans lequel des 3 groupes de menu séparés (Clients/Agents/
// Marchands, Organisation Interne, Trésorerie > Comptes Système) chercher. Ici, un
// seul écran avec des onglets ; chaque onglet réutilise l'écran spécialisé existant
// tel quel (Users, AgencyCenter, StaffAssignBranch...) plutôt que de tout refondre en
// un unique tableau géant — des comptes aussi différents qu'un client KYC, un membre
// du personnel ou un wallet technique n'ont ni les mêmes champs ni les mêmes actions.
type AccountsTab = 'clients' | 'agents' | 'staff' | 'branches' | 'system';
type StaffSubTab = 'assign' | 'create' | 'rights';

export default function Accounts({ token, role, hasPerm, onAdjustSystemAccount }: { token: string; role?: string; hasPerm?: (perms: string[]) => boolean; onAdjustSystemAccount?: (walletId: string, name: string) => void }) {
    const [tab, setTab] = useState<AccountsTab>('clients');
    // "Affectation" (le roster consultable/filtrable) est le point d'entrée le plus
    // naturel pour gérer le personnel — "Créer" et "Droits" restent à un clic, mais
    // ne sont plus les premières choses vues en arrivant sur l'onglet Personnel.
    const [staffTab, setStaffTab] = useState<StaffSubTab>('assign');

    // La garde au niveau de App.tsx (perm_customer_view OU perm_staff_view) ne suffit qu'à
    // ouvrir CET écran — pas à autoriser chacun de ses 5 sous-onglets, qui exigent chacun
    // côté serveur une permission différente (ex. perm_branch_manage pour Agences,
    // perm_treasury_view pour Comptes Système). Sans ce filtre, un rôle qui n'a que
    // perm_customer_view voyait quand même "Agences"/"Comptes Système", cliquait dessus, et
    // se heurtait à un message d'erreur plutôt que de ne jamais voir l'onglet.
    const canHasPerm = hasPerm || (() => true);
    const tabs = [
        { id: 'clients' as const, icon: <UsersIcon size={18} />, label: 'Clients & Marchands' },
        { id: 'agents' as const, icon: <Briefcase size={18} />, label: 'Agents (ancien système)' },
        ...(canHasPerm(['perm_staff_view']) ? [{ id: 'staff' as const, icon: <ShieldCheck size={18} />, label: 'Personnel' }] : []),
        ...(canHasPerm(['perm_branch_manage']) ? [{ id: 'branches' as const, icon: <Building2 size={18} />, label: 'Agences' }] : []),
        ...(canHasPerm(['perm_treasury_view']) ? [{ id: 'system' as const, icon: <Server size={18} />, label: 'Comptes Système' }] : []),
    ];

    const staffTabs = [
        { id: 'assign' as const, label: 'Roster & Affectation' },
        { id: 'create' as const, label: 'Créer un Utilisateur' },
        { id: 'rights' as const, label: "Droits d'Accès" },
    ];

    return (
        <div>
            {/* Pas de PageHeader ici : chaque onglet embarque déjà le sien (ex: Users.tsx
                "Comptes Clients & Marchands (C-360)") — en ajouter un ici ne faisait que
                superposer deux gros titres et rendre l'écran touffu. La barre du haut
                (fil d'Ariane) suffit à situer "où on est" ; cette TabBar dit "quoi". */}
            <TabBar<AccountsTab> tabs={tabs} active={tab} onChange={setTab} />

            {tab === 'clients' && <Users token={token} staffRole={role} hasPerm={canHasPerm} />}
            {tab === 'agents' && <Users token={token} staffRole={role} hasPerm={canHasPerm} lockedRole="AGENT" />}
            {tab === 'branches' && <AgencyCenter token={token} hasPerm={hasPerm || (() => true)} />}
            {tab === 'system' && <SystemAccounts token={token} onAdjust={onAdjustSystemAccount} />}

            {tab === 'staff' && (
                <div>
                    <TabBar<StaffSubTab> tabs={staffTabs} active={staffTab} onChange={setStaffTab} />
                    {staffTab === 'assign' && <StaffAssignBranch token={token} />}
                    {staffTab === 'create' && <StaffCreate token={token} />}
                    {staffTab === 'rights' && <StaffAccessRights token={token} />}
                </div>
            )}
        </div>
    );
}
