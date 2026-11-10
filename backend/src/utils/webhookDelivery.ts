import crypto from 'crypto';
import { prisma } from '../prisma';
import logger from './logger';

// Livraison de webhooks Mongain Connect (voir routes/gateway.ts, routes/b2b.ts
// /invoices/:id/pay et /reject) — best-effort, UN SEUL essai automatique par évènement :
// aucune infrastructure de job de fond n'existe dans ce backend (voir schema.prisma,
// commentaire sur ApiWebhookDelivery), donc pas de retry planifié — un échec reste
// journalisé et rejouable manuellement (voir retryWebhookDelivery ci-dessous).
const WEBHOOK_TIMEOUT_MS = 5000;

export interface WebhookIntegration {
    id: string;
    webhookUrl: string | null;
    webhookSigningSecret: string | null;
}

function signPayload(body: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

async function performDelivery(url: string, body: string, signature: string): Promise<{ status: 'DELIVERED' | 'FAILED'; httpStatus: number | null; lastError: string | null }> {
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Mongain-Signature': signature,
            },
            body,
            // Node 22 : AbortSignal.timeout est natif, pas besoin d'un AbortController manuel.
            signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
        });

        return {
            status: response.ok ? 'DELIVERED' : 'FAILED',
            httpStatus: response.status,
            lastError: response.ok ? null : `Réponse HTTP ${response.status}`,
        };
    } catch (e: any) {
        const isTimeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
        return {
            status: 'FAILED',
            httpStatus: null,
            lastError: isTimeout ? 'Délai d\'attente dépassé (5s).' : (e?.message || 'Erreur réseau.'),
        };
    }
}

// Calcule la signature HMAC-SHA256 du payload JSON avec le secret de signature de
// l'intégration, POST le tout à `integration.webhookUrl`, puis journalise le résultat dans
// ApiWebhookDelivery (une ligne par évènement). Si `webhookUrl` est vide, ne fait rien
// silencieusement — un marchand n'ayant configuré aucun webhook n'est pas une erreur.
//
// IMPORTANT : cette fonction ASYNCHRONE ne doit JAMAIS être `await`ée depuis le chemin
// critique d'une route qui répond à un payeur — le POST sortant peut prendre jusqu'à ~5s
// (timeout réseau) avant de résoudre. Les appelants (routes/b2b.ts) la déclenchent donc sans
// `await`, avec un `.catch()` pour ne jamais laisser un rejet de promesse non intercepté.
export async function deliverWebhook(
    integration: WebhookIntegration,
    eventType: string,
    payload: Record<string, unknown>
): Promise<void> {
    if (!integration.webhookUrl || !integration.webhookSigningSecret) return;

    const body = JSON.stringify(payload);
    const signature = signPayload(body, integration.webhookSigningSecret);

    const { status, httpStatus, lastError } = await performDelivery(integration.webhookUrl, body, signature);

    try {
        await prisma.apiWebhookDelivery.create({
            data: {
                integrationId: integration.id,
                eventType,
                payload: body,
                status,
                httpStatus,
                lastError,
                attempts: 1,
                deliveredAt: status === 'DELIVERED' ? new Date() : null,
            },
        });
    } catch (e) {
        // La journalisation elle-même échoue (hoquet DB) — ne doit jamais remonter jusqu'à
        // l'appelant (déjà découplé du chemin critique de toute façon), juste tracé côté logs.
        logger.error('[Webhook] Échec de journalisation de la livraison', e);
    }
}

// Rejeu manuel d'une livraison FAILED (voir routes/gateway.ts POST
// /webhook-deliveries/:id/retry) — réutilise le payload déjà stocké TEL QUEL (rejeu
// identique, resigné avec le secret courant de l'intégration), incrémente `attempts` au lieu
// de le réinitialiser. Synchrone du point de vue de l'appelant : c'est un geste explicite du
// marchand (clic sur "Rejouer"), pas le chemin critique d'un paiement — attendre son résultat
// ici est acceptable.
export async function retryWebhookDelivery(
    delivery: { id: string; payload: string },
    integration: WebhookIntegration
): Promise<void> {
    if (!integration.webhookUrl || !integration.webhookSigningSecret) {
        throw new Error("Cette intégration n'a plus d'URL de webhook ou de secret de signature configuré.");
    }

    const signature = signPayload(delivery.payload, integration.webhookSigningSecret);
    const { status, httpStatus, lastError } = await performDelivery(integration.webhookUrl, delivery.payload, signature);

    await prisma.apiWebhookDelivery.update({
        where: { id: delivery.id },
        data: {
            status,
            httpStatus,
            lastError,
            attempts: { increment: 1 },
            deliveredAt: status === 'DELIVERED' ? new Date() : null,
        },
    });
}
