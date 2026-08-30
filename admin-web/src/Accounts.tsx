import { ShieldCheck, Users as UsersIcon } from 'lucide-react';
import { useState } from 'react';
import TabBar from './components/TabBar';
import StaffAccessRights from './StaffAccessRights';
import StaffAssignBranch from './StaffAssignBranch';
import StaffCreate from './StaffCreate';
import Users from './Users';

// Vue centralisée Comptes : Clients/Marchands + Personnel.
// Les Agences → menu sidebar 'Réseau d'Agences'.
// Les Comptes Système → menu sidebar 'Comptes Système'.
type AccountsTab = 'clients' | 'staff';
type StaffSubTab = 'assign' | 'create' | 'rights';

export default function Accounts({ token, role, hasPerm }: { token: string; role?: string; hasPerm?: (perms: string[]) => boolean }) {
    const [tab, setTab] = useState<AccountsTab>('clients');
    const [staffTab, setStaffTab] = useState<StaffSubTab>('assign');

    const canHasPerm = hasPerm || (() => true);
    const tabs = [
        { id: 'clients' as const, icon: <UsersIcon size={18} />, label: 'Clients & Marchands' },
        ...(canHasPerm(['perm_staff_view']) ? [{ id: 'staff' as const, icon: <ShieldCheck size={18} />, label: 'Personnel & Droits' }] : []),
    ];

    const staffTabs = [
        { id: 'assign' as const, label: 'Roster & Affectation' },
        { id: 'create' as const, label: 'Créer un Utilisateur' },
        { id: 'rights' as const, label: "Droits d'Accès" },
    ];

    return (
        <div>
            <TabBar<AccountsTab> tabs={tabs} active={tab} onChange={setTab} />

            {tab === 'clients' && <Users token={token} staffRole={role} hasPerm={canHasPerm} />}

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
