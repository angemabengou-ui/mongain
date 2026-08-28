import * as Contacts from 'expo-contacts';
import { apiMatchContacts } from './api';

// Même normalisation que l'ancienne saisie manuelle (InlineInviteForm, transfer.tsx) —
// mais le carnet d'adresses du téléphone est bien plus "sale" qu'une saisie clavier
// (espaces, tirets, indicatif international déjà présent ou non) donc plus tolérant ici.
export function normalizePhone(raw: string): string {
    let cleaned = raw.replace(/[^\d+]/g, '');
    if (cleaned.startsWith('+')) return cleaned;
    if (cleaned.startsWith('00')) return '+' + cleaned.slice(2);
    if (cleaned.startsWith('241')) return '+' + cleaned;
    if (cleaned.startsWith('0')) cleaned = cleaned.slice(1);
    return '+241' + cleaned;
}

export type MongainContact = {
    id: string;
    name: string; // nom du compte Mongain
    phone: string;
    role: string;
    contactName?: string; // nom tel qu'enregistré dans le carnet du téléphone, si connu
};

// Lit le carnet de contacts du téléphone (avec permission), normalise chaque numéro, puis
// demande au serveur lesquels correspondent à un compte Mongain déjà inscrit — même
// principe que WhatsApp : afficher directement "qui de mes contacts est sur Mongain"
// plutôt que de faire deviner/taper un numéro pour chaque personne.
export async function findMongainContacts(): Promise<{ granted: boolean; contacts: MongainContact[] }> {
    const { status } = await Contacts.requestPermissionsAsync();
    if (status !== 'granted') return { granted: false, contacts: [] };

    const { data } = await Contacts.getContactsAsync({ fields: [Contacts.Fields.PhoneNumbers] });

    const phoneToName = new Map<string, string>();
    for (const contact of data) {
        if (!contact.phoneNumbers) continue;
        for (const p of contact.phoneNumbers) {
            if (!p.number) continue;
            const normalized = normalizePhone(p.number);
            if (!phoneToName.has(normalized)) phoneToName.set(normalized, contact.name || 'Contact');
        }
    }

    const uniquePhones = Array.from(phoneToName.keys());
    if (uniquePhones.length === 0) return { granted: true, contacts: [] };

    const { matches } = await apiMatchContacts(uniquePhones);
    const contacts: MongainContact[] = matches.map((m) => ({ ...m, contactName: phoneToName.get(m.phone) }));
    contacts.sort((a, b) => (a.contactName || a.name).localeCompare(b.contactName || b.name));
    return { granted: true, contacts };
}
