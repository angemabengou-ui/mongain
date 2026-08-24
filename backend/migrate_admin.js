const fs = require('fs');
const path = require('path');

const targetPath = path.join(__dirname, 'src', 'routes', 'admin.ts');
let code = fs.readFileSync(targetPath, 'utf8');

// 1. Add import for hasPermission if not present
if (!code.includes("import { hasPermission }")) {
    code = code.replace("import { friendlyErrorMessage } from '../utils/errors';", "import { hasPermission } from '../services/RBAC';\nimport { friendlyErrorMessage } from '../utils/errors';");
}

// 2. Replace all generic findUnique queries for RBAC checking
const findUniqueRegex1 = /prisma\.staff\.findUnique\(\{\s*where:\s*\{\s*id:\s*(req\.userId|userId)\s*\}\s*\}\)/g;
code = code.replace(findUniqueRegex1, "prisma.staff.findUnique({ where: { id: $1 }, select: { id: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } })");

const findUniqueRegex2 = /prisma\.user\.findUnique\(\{\s*where:\s*\{\s*id:\s*(req\.userId|userId)\s*\}\s*\}\)/g;
code = code.replace(findUniqueRegex2, "// USER accounts do not use RBAC, this is admin space so we fetch staff instead (fallback if requested)\n        prisma.staff.findUnique({ where: { id: $1 }, select: { id: true, role: true, isActive: true, permissions: true, permissionsCustomized: true, branchId: true } })");


// 3. Mapping of arrays to permissions
code = code.replace(/!AGENCY_ADMIN_ROLES\.includes\(([\w]+)\.role\)/g, "!hasPermission($1, 'perm_branch_manage')");
code = code.replace(/AGENCY_ADMIN_ROLES\.includes\(([\w]+)\.role\)/g, "hasPermission($1, 'perm_branch_manage')");

code = code.replace(/!AGENCY_OPS_ROLES\.includes\(([\w]+)\.role\)/g, "!hasPermission($1, 'perm_branch_view')");
code = code.replace(/AGENCY_OPS_ROLES\.includes\(([\w]+)\.role\)/g, "hasPermission($1, 'perm_branch_view')");

code = code.replace(/!KYC_ROLES\.includes\(([\w]+)\.role\)/g, "!hasPermission($1, 'perm_customer_kyc_validate')");
code = code.replace(/KYC_ROLES\.includes\(([\w]+)\.role\)/g, "hasPermission($1, 'perm_customer_kyc_validate')");

code = code.replace(/!CRM_FULL_ACCESS\.includes\(([\w]+)\.role\)/g, "!hasPermission($1, 'perm_customer_360_basic')");
code = code.replace(/CRM_FULL_ACCESS\.includes\(([\w]+)\.role\)/g, "hasPermission($1, 'perm_customer_360_basic')");

code = code.replace(/!CRM_BROAD_ACCESS\.includes\(([\w]+)\.role\)/g, "!hasPermission($1, 'perm_customer_view')");
code = code.replace(/CRM_BROAD_ACCESS\.includes\(([\w]+)\.role\)/g, "hasPermission($1, 'perm_customer_view')");

code = code.replace(/!CRM_RISK_ROLES\.includes\(([\w]+)\.role\)/g, "!hasPermission($1, 'perm_customer_freeze')");
code = code.replace(/CRM_RISK_ROLES\.includes\(([\w]+)\.role\)/g, "hasPermission($1, 'perm_customer_freeze')");

code = code.replace(/!SUPPORT_ROLES\.includes\(([\w]+)\.role\)/g, "!hasPermission($1, 'perm_ticket_resolve')");
code = code.replace(/SUPPORT_ROLES\.includes\(([\w]+)\.role\)/g, "hasPermission($1, 'perm_ticket_resolve')");

code = code.replace(/!FRAUD_ROLES\.includes\(([\w]+)\.role\)/g, "!hasPermission($1, 'perm_customer_flag')");
code = code.replace(/FRAUD_ROLES\.includes\(([\w]+)\.role\)/g, "hasPermission($1, 'perm_customer_flag')");

code = code.replace(/!FINANCE_ROLES\.includes\(([\w]+)\.role\)/g, "!hasPermission($1, 'perm_refund_approve')");
code = code.replace(/FINANCE_ROLES\.includes\(([\w]+)\.role\)/g, "hasPermission($1, 'perm_refund_approve')");

// 4. Manual hardcoded array replacements
const hardcodedArrays = [
    { regex: /!\['SUPER_ADMIN',\s*'RISK',\s*'COMPLIANCE_CHECKER'\]\.includes\(([\w]+)\.role\)/g, perm: 'perm_system_settings_view' },
    { regex: /\['SUPER_ADMIN',\s*'RISK',\s*'COMPLIANCE_CHECKER'\]\.includes\(([\w]+)\.role\)/g, perm: 'perm_system_settings_view' },

    { regex: /!\['SUPER_ADMIN',\s*'RISK'\]\.includes\(([\w]+)\.role\)/g, perm: 'perm_audit_log_view' },
    { regex: /\['SUPER_ADMIN',\s*'RISK'\]\.includes\(([\w]+)\.role\)/g, perm: 'perm_audit_log_view' },

    { regex: /!\['SUPER_ADMIN',\s*'RISK',\s*'SUPPORT_MAKER',\s*'COMPLIANCE_CHECKER'\]\.includes\(([\w]+)\.role\)/g, perm: 'perm_ticket_resolve' },
    { regex: /!\['SUPER_ADMIN',\s*'RISK',\s*'SUPPORT_MAKER'\]\.includes\(([\w]+)\.role\)/g, perm: 'perm_ticket_view' },
    { regex: /!\['SUPER_ADMIN',\s*'SUPPORT_MAKER',\s*'RISK'\]\.includes\(([\w]+)\.role\)/g, perm: 'perm_ticket_view' },
    { regex: /!\['TELLER',\s*'BRANCH_MANAGER',\s*'SUPER_ADMIN'\]\.includes\(([\w]+)\.role\)/g, perm: 'perm_cash_out' },
];

for (const item of hardcodedArrays) {
    code = code.replace(item.regex, (match, p1) => {
        return (match.startsWith('!') ? '!' : '') + `hasPermission(${p1}, '${item.perm}')`;
    });
}

fs.writeFileSync(targetPath, code, 'utf8');
console.log('Successfully applied RBAC patches to admin.ts');
