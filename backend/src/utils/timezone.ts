// Le serveur (Render) tourne en UTC, mais les frontières "aujourd'hui"/"ce mois" doivent
// suivre le fuseau configuré par l'admin (SystemSettings.timezone, défaut Africa/Libreville
// = UTC+1 fixe, sans heure d'été) — pas l'heure du process. `new Date().setHours(0,0,0,0)`
// calcule minuit en heure SERVEUR, décalé d'une heure par rapport à minuit à Libreville :
// une vente entre 00h00 et 00h59 heure locale gabonaise était comptée sur le mauvais jour
// dans les stats marchand (merchant.ts) et le reset des plafonds journaliers (cron.ts).
//
// Implémenté avec Intl.DateTimeFormat (ICU intégré à Node, aucune dépendance) plutôt qu'un
// simple décalage fixe codé en dur, pour rester correct si `timezone` est un jour reconfiguré
// vers un fuseau observant l'heure d'été.
export function startOfDayInTimezone(timeZone: string, reference: Date = new Date()): Date {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(reference);
    const get = (type: string) => Number(parts.find(p => p.type === type)!.value);

    // Instant UTC qui correspondrait à l'heure murale actuelle SI le fuseau était UTC — sert
    // de pivot pour calculer le décalage réel entre ce fuseau et UTC à cet instant précis.
    const wallClockAsUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    const offsetMs = wallClockAsUTC - reference.getTime();

    // Minuit heure murale dans ce fuseau, exprimé comme un vrai instant UTC.
    const localMidnightAsUTC = Date.UTC(get('year'), get('month') - 1, get('day'), 0, 0, 0);
    return new Date(localMidnightAsUTC - offsetMs);
}

// Même principe que startOfDayInTimezone, pour le 1er du mois à 00h00 heure locale.
export function startOfMonthInTimezone(timeZone: string, reference: Date = new Date()): Date {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(reference);
    const get = (type: string) => Number(parts.find(p => p.type === type)!.value);

    const wallClockAsUTC = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    const offsetMs = wallClockAsUTC - reference.getTime();

    const localMonthStartAsUTC = Date.UTC(get('year'), get('month') - 1, 1, 0, 0, 0);
    return new Date(localMonthStartAsUTC - offsetMs);
}
