/**
 * RBAC — Gestion Granulaire des Droits (Role-Based Access Control)
 *
 * Architecture inspirée de Sage / Dolibarr :
 *  - Chaque action possible dans l'application correspond à un "droit" unitaire (permission).
 *  - Un rôle (ex: TELLER, BRANCH_MANAGER) possède un ensemble de permissions par défaut.
 *  - Un SUPER_ADMIN peut surcharger les permissions d'un employé individuellement
 *    (champ Staff.permissions dans la base, Staff.permissionsCustomized = true).
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. CATALOGUE DES PERMISSIONS (toutes les actions de l'application)
// ─────────────────────────────────────────────────────────────────────────────

export const ALL_PERMISSIONS = [
    // ── Clients & CRM ──────────────────────────────────────────────────────
    'perm_customer_view',           // Voir la liste des clients
    'perm_customer_360_basic',      // Voir le profil de base d'un client
    'perm_customer_wallet_view',    // Voir le solde & wallet d'un client
    'perm_customer_kyc_view',       // Voir les photos KYC (CNI/selfie) d'un client
    'perm_customer_kyc_validate',   // Approuver/Rejeter un dossier KYC
    'perm_customer_flag',           // Signaler un client comme suspect (Risk Flag)
    'perm_customer_freeze',         // Geler / Dégeler le compte d'un client
    'perm_customer_suspend',        // Suspendre / Réactiver un compte client
    // ── Cash Operations (Guichet) ──────────────────────────────────────────
    'perm_cash_session_open',       // Ouvrir une session de caisse
    'perm_cash_session_close',      // Clôturer une session de caisse
    'perm_cash_in',                 // Effectuer un dépôt (cash-in) pour un client
    'perm_cash_out',                // Effectuer un retrait (cash-out) pour un client
    // ── Transactions & Historique ──────────────────────────────────────────
    'perm_transaction_view',        // Voir l'historique des transactions
    'perm_refund_request',          // Créer une demande de remboursement (Maker)
    'perm_refund_approve',          // Approuver un remboursement (Checker)
    // ── Support & Réclamations ─────────────────────────────────────────────
    'perm_ticket_view',             // Voir les réclamations liées à un client
    'perm_ticket_create',           // Créer un ticket de réclamation
    'perm_ticket_resolve',          // Modifier/Clôturer un ticket
    'perm_support_note',            // Ajouter une note interne de support
    // ── Agences ────────────────────────────────────────────────────────────
    'perm_branch_view',             // Voir les données de son agence
    'perm_branch_manage',           // Gérer les paramètres/liquidités d'une agence
    // ── Trésorerie & Système ───────────────────────────────────────────────
    'perm_treasury_view',           // Voir la masse monétaire globale 
    'perm_treasury_mint',           // Émettre de la nouvelle monnaie (Mint)
    'perm_treasury_allocate',       // Allouer des fonds à une agence
    'perm_treasury_approve',        // Approuver une demande de trésorerie (checker)
    'perm_system_settings_view',    // Voir les paramètres système
    'perm_system_settings_edit',    // Modifier les paramètres système (maker)
    'perm_system_settings_approve', // Approuver une modification de paramètre (checker)
    // ── Personnel & Administration ─────────────────────────────────────────
    'perm_staff_view',              // Voir la liste du personnel
    'perm_staff_manage',            // Créer/Modifier des comptes employés
    'perm_staff_permissions_edit',  // Modifier les droits d'un employé (SUPER_ADMIN only)
    // ── Rapports & Analytique ──────────────────────────────────────────────
    'perm_analytics_view',          // Voir le tableau de bord analytique (MacroStats)
    'perm_audit_log_view',          // Voir les journaux d'audit
] as const;

export type Permission = typeof ALL_PERMISSIONS[number];

// ─────────────────────────────────────────────────────────────────────────────
// 2. DROITS PAR DÉFAUT PAR RÔLE
// ─────────────────────────────────────────────────────────────────────────────

export const ROLE_DEFAULT_PERMISSIONS: Record<string, Permission[]> = {
    SUPER_ADMIN: [...ALL_PERMISSIONS], // Accès total
    ADMIN: [...ALL_PERMISSIONS],       // Tolérance pour les anciens comptes non migrés

    BRANCH_MANAGER: [
        'perm_customer_view',
        'perm_customer_360_basic',
        'perm_customer_wallet_view',
        'perm_customer_kyc_view',       // ✅ Le responsable d'agence peut voir les photos KYC
        'perm_customer_kyc_validate',   // ✅ Peut valider les KYC
        'perm_customer_flag',
        'perm_cash_session_open',
        'perm_cash_session_close',
        'perm_cash_in',
        'perm_cash_out',
        'perm_transaction_view',
        'perm_refund_request',
        'perm_ticket_view',
        'perm_ticket_create',
        'perm_ticket_resolve',
        'perm_support_note',
        'perm_branch_view',
        'perm_branch_manage',
        'perm_staff_view',
        'perm_analytics_view',
    ],

    TELLER: [
        'perm_customer_view',
        'perm_customer_360_basic',
        'perm_customer_kyc_view',       // ✅ L'agent de guichet peut vérifier la pièce d'identité physique
        'perm_cash_session_open',
        'perm_cash_session_close',
        'perm_cash_in',
        'perm_cash_out',
        'perm_transaction_view',
        'perm_ticket_view',
        'perm_ticket_create',
        'perm_support_note',
        'perm_branch_view',
    ],

    RISK: [
        'perm_customer_view',
        'perm_customer_360_basic',
        'perm_customer_wallet_view',
        'perm_customer_kyc_view',
        'perm_customer_flag',
        'perm_customer_freeze',
        'perm_transaction_view',
        'perm_refund_request',
        'perm_ticket_view',
        'perm_audit_log_view',
        'perm_analytics_view',
        'perm_treasury_view',
    ],

    COMPLIANCE_CHECKER: [
        'perm_customer_view',
        'perm_customer_360_basic',
        'perm_customer_wallet_view',
        'perm_customer_kyc_view',
        'perm_customer_kyc_validate',
        'perm_refund_approve',
        'perm_ticket_resolve',
        'perm_system_settings_approve',
        'perm_treasury_approve',        // ✅ Le Checker vérifie la Trésorerie
        'perm_audit_log_view',
        'perm_analytics_view',
    ],

    SUPPORT_MAKER: [
        'perm_customer_view',
        'perm_customer_360_basic',
        'perm_customer_kyc_view',
        'perm_transaction_view',
        'perm_refund_request',
        'perm_ticket_view',
        'perm_ticket_create',
        'perm_ticket_resolve',
        'perm_support_note',
    ],
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. UTILITAIRES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retourne la liste des permissions effectives pour un employé.
 * Si l'employé a des permissions personnalisées (permissionsCustomized = true),
 * on les utilise. Sinon, on hérite des défauts du rôle.
 */
export function getEffectivePermissions(staff: {
    role: string;
    permissions?: any;
    permissionsCustomized?: boolean;
}): Set<string> {
    if (staff.permissionsCustomized && Array.isArray(staff.permissions)) {
        return new Set(staff.permissions as string[]);
    }
    return new Set(ROLE_DEFAULT_PERMISSIONS[staff.role] ?? []);
}

/**
 * Vérifie si un employé possède une permission donnée.
 */
export function hasPermission(
    staff: { role: string; permissions?: any; permissionsCustomized?: boolean },
    permission: Permission
): boolean {
    return getEffectivePermissions(staff).has(permission);
}

/**
 * Groupement des permissions par catégorie pour affichage dans la matrice UI.
 */
export const PERMISSION_GROUPS: { label: string; perms: Permission[] }[] = [
    {
        label: 'Clients & CRM',
        perms: [
            'perm_customer_view', 'perm_customer_360_basic', 'perm_customer_wallet_view',
            'perm_customer_kyc_view', 'perm_customer_kyc_validate', 'perm_customer_flag',
            'perm_customer_freeze', 'perm_customer_suspend',
        ],
    },
    {
        label: 'Guichet (Cash)',
        perms: ['perm_cash_session_open', 'perm_cash_session_close', 'perm_cash_in', 'perm_cash_out'],
    },
    {
        label: 'Transactions & Remboursements',
        perms: ['perm_transaction_view', 'perm_refund_request', 'perm_refund_approve'],
    },
    {
        label: 'Support & Réclamations',
        perms: ['perm_ticket_view', 'perm_ticket_create', 'perm_ticket_resolve', 'perm_support_note'],
    },
    {
        label: 'Agences',
        perms: ['perm_branch_view', 'perm_branch_manage'],
    },
    {
        label: 'Trésorerie & Système',
        perms: [
            'perm_treasury_view', 'perm_treasury_mint', 'perm_treasury_allocate', 'perm_treasury_approve',
            'perm_system_settings_view', 'perm_system_settings_edit', 'perm_system_settings_approve',
        ],
    },
    {
        label: 'Personnel & Administration',
        perms: ['perm_staff_view', 'perm_staff_manage', 'perm_staff_permissions_edit'],
    },
    {
        label: 'Rapports & Audit',
        perms: ['perm_analytics_view', 'perm_audit_log_view'],
    },
];
