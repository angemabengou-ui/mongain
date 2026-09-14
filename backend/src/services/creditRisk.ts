import { prisma } from '../prisma';
import { sendPush } from '../routes/wallet';
import logger from '../utils/logger';

// ==========================================
// Gestion du retard/défaut sur les produits de crédit (Loan, BnplContract)
// ==========================================
//
// Avant ce fichier : Loan.status supportait DEFAULTED mais rien ne le posait jamais (aucune
// échéance stockée), et BnplContract.nextPaymentDate était écrite une fois à la souscription
// puis plus jamais lue — un client pouvait indéfiniment ne jamais rembourser sans la moindre
// conséquence. Regroupe ici la logique partagée (transition + notification) entre le prêt
// classique (credit.ts) et le BNPL (bnpl.ts) pour ne pas dupliquer ce couple
// blocage/notification deux fois, et le garde de blocage réutilisé par les DEUX routes
// d'octroi (une dette DEFAULTED sur l'UN des deux produits bloque l'octroi sur les DEUX,
// comme demandé par l'audit).

type DebtKind = 'loan' | 'bnpl';

// Transitionne un prêt/contrat BNPL en DEFAULTED de façon atomique (updateMany avec garde de
// statut — même convention que le "claim" de StakingVault.withdraw ou l'idempotence des
// transferts : si un autre appel concurrent a déjà traité cette dette, `count` vaut 0 et on ne
// notifie pas deux fois) puis notifie le client via Notification persistée + push Expo — même
// paire que credit.ts/bnpl.ts pour tout évènement argent visible par le client (aucun accès à
// `req.app.get('io')` ici : ce code tourne hors requête HTTP, dans un job périodique).
async function markDefaulted(kind: DebtKind, id: string, userId: string, pushToken: string | null | undefined, title: string, body: string): Promise<boolean> {
    const claimed = await prisma.$transaction(async (tx) => {
        const updated = kind === 'loan'
            ? await tx.loan.updateMany({ where: { id, status: 'ACTIVE' }, data: { status: 'DEFAULTED' } })
            : await tx.bnplContract.updateMany({ where: { id, status: 'ACTIVE' }, data: { status: 'DEFAULTED' } });
        if (updated.count === 0) return false;

        await tx.notification.create({ data: { userId, title, body, type: 'TRANSACTION' } });
        return true;
    });

    if (claimed) {
        await sendPush(pushToken, title, body);
    }
    return claimed;
}

// Prêts ACTIVE dont l'échéance (Loan.dueDate, voir credit.ts /apply) est dépassée -> DEFAULTED.
// Les prêts créés avant l'ajout de cette colonne ont dueDate=null et ne sont JAMAIS
// sélectionnés ici (Postgres : NULL < now() est toujours faux) — aucune échéance ne leur avait
// été promise, on ne peut pas les faire défaillir rétroactivement sur une règle qui n'existait
// pas au moment de leur octroi.
export async function checkOverdueLoans(): Promise<void> {
    const now = new Date();
    const overdue = await prisma.loan.findMany({
        where: { status: 'ACTIVE', dueDate: { lt: now } },
        include: { user: { select: { pushToken: true } } }
    });

    for (const loan of overdue) {
        try {
            const title = 'Crédit en défaut de paiement';
            const body = `Votre micro-crédit de ${loan.amount.toLocaleString('fr-FR')} FCFA (total dû : ${loan.totalOwed.toLocaleString('fr-FR')} FCFA) a dépassé son échéance sans être remboursé et a été marqué en défaut. Contactez le support pour régulariser.`;
            const changed = await markDefaulted('loan', loan.id, loan.userId, loan.user.pushToken, title, body);
            if (changed) logger.info(`[Credit Risk] Prêt ${loan.id} (user ${loan.userId}) marqué DEFAULTED (échéance dépassée).`);
        } catch (e: any) {
            logger.error(`[Credit Risk] Échec transition DEFAULTED du prêt ${loan.id} : ${e.message}`);
        }
    }
}

// Contrats BNPL ACTIVE dont l'échéance de la prochaine mensualité (nextPaymentDate) est
// dépassée avec un solde restant dû (remaining > 0) -> DEFAULTED. `remaining <= 0` est déjà
// fermé en CLOSED par bnpl.ts /repay et ne peut de toute façon plus matcher `status: 'ACTIVE'`,
// le filtre `remaining: { gt: 0 }` documente simplement l'invariant attendu.
//
// Interprétation retenue pour "l'échéancier n'est jamais avancé" (audit finding #5) : un
// remboursement partiel/à temps (bnpl.ts /repay) avance désormais nextPaymentDate d'un mois à
// chaque paiement qui laisse le contrat ACTIVE (voir bnpl.ts) — un client qui paie
// régulièrement, même partiellement, ne se fait donc jamais défaillir par ce job tant qu'il
// respecte son rythme mensuel, sans avoir à modéliser un plan d'amortissement par mensualité
// individuelle (absent du modèle BnplContract actuel : seul un total `remaining` est suivi).
export async function checkOverdueBnplContracts(): Promise<void> {
    const now = new Date();
    const overdue = await prisma.bnplContract.findMany({
        where: { status: 'ACTIVE', nextPaymentDate: { lt: now }, remaining: { gt: 0 } },
        include: { user: { select: { pushToken: true } } }
    });

    for (const contract of overdue) {
        try {
            const title = 'BNPL en défaut de paiement';
            const body = `Votre échéance BNPL n'a pas été réglée à temps (reste dû : ${contract.remaining.toLocaleString('fr-FR')} FCFA). Le contrat a été marqué en défaut. Contactez le support pour régulariser.`;
            const changed = await markDefaulted('bnpl', contract.id, contract.userId, contract.user.pushToken, title, body);
            if (changed) logger.info(`[Credit Risk] Contrat BNPL ${contract.id} (user ${contract.userId}) marqué DEFAULTED (échéance dépassée).`);
        } catch (e: any) {
            logger.error(`[Credit Risk] Échec transition DEFAULTED du contrat BNPL ${contract.id} : ${e.message}`);
        }
    }
}

// Utilisé par credit.ts (computeCreditEligibility) ET bnpl.ts (garde "une seule dette active")
// pour bloquer l'octroi d'un NOUVEAU produit de crédit dès qu'UN SEUL des deux (prêt ou BNPL)
// est DEFAULTED — pas seulement le même produit que celui demandé, comme l'exige l'audit
// ("blocks new BNPL/credit while DEFAULTED" sur les deux findings #4 et #5). `client` accepte
// soit le PrismaClient racine, soit un client de transaction (`tx`), même convention que
// getSystemAccount/getCentralTreasury.
export async function hasDefaultedCreditDebt(userId: string, client: any = prisma): Promise<boolean> {
    const [defaultedLoan, defaultedBnpl] = await Promise.all([
        client.loan.findFirst({ where: { userId, status: 'DEFAULTED' }, select: { id: true } }),
        client.bnplContract.findFirst({ where: { userId, status: 'DEFAULTED' }, select: { id: true } }),
    ]);
    return !!(defaultedLoan || defaultedBnpl);
}
