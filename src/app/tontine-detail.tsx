import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useCallback, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    KeyboardAvoidingView,
    Modal,
    Platform,
    RefreshControl,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import BalanceCard from '../components/ui/BalanceCard';
import InlineInviteForm from '../components/ui/InlineInviteForm';
import ScreenHeader from '../components/ui/ScreenHeader';
import SectionHeading from '../components/ui/SectionHeading';
import { useAppTheme } from '../constants/theme';
import { useAuth } from '../context/AuthContext';
import {
    apiGetTontineDetails,
    apiInviteToTontine,
    apiLeaveTontine,
    apiContributeTontine,
    apiReorderTontine,
    apiVoteTontineRenewal,
} from '../services/api';

// Score de ponctualité calculé depuis l'historique déjà chargé (group.cycles, 12 derniers
// cycles) — aucun appel serveur dédié. Rendu visible à TOUT le groupe (pas seulement au
// créateur) : dans une tontine physique, qui paie en retard est déjà un fait public au sein
// du groupe — c'est précisément cette pression sociale, difficile à recréer une fois la
// tontine numérisée, que ce badge rend à nouveau visible plutôt que de la faire disparaître
// derrière un simple statut binaire "payé/en attente" côté serveur.
function computeReliability(participantId: string, cycles: any[]) {
    let paid = 0, total = 0;
    cycles.forEach((c: any) => {
        const contrib = (c.contributions || []).find((x: any) => x.participantId === participantId);
        if (contrib) { total++; if (contrib.status === 'PAID') paid++; }
    });
    return { paid, total };
}

// Détail par participant, tour par tour — depuis les cycles déjà chargés (group.cycles),
// aucun appel serveur dédié. Répond au besoin de voir en un coup d'œil combien quelqu'un a
// déjà versé (ou combien il doit, si des cotisations ont échoué sans jamais être rattrapées)
// sans avoir à recouper soi-même l'historique global des transactions du club.
function computeParticipantLedger(participantId: string, cycles: any[], groupContribution: number) {
    let totalPaid = 0;
    let totalOwed = 0;
    const rows = cycles.map((c: any) => {
        const contrib = (c.contributions || []).find((x: any) => x.participantId === participantId);
        // amount = montant CUMULÉ réellement versé pour PAID/PARTIAL (dépôts libres, voir
        // tontineService.ts) ; pour FAILED (statut hérité des cycles antérieurs aux dépôts
        // libres), amount représente au contraire le montant JAMAIS collecté.
        if (contrib?.status === 'PAID') totalPaid += contrib.amount;
        if (contrib?.status === 'PARTIAL') {
            totalPaid += contrib.amount;
            totalOwed += Math.max(0, groupContribution - contrib.amount);
        }
        if (contrib?.status === 'FAILED') totalOwed += contrib.amount;
        return {
            cycleNumber: c.cycleNumber,
            status: contrib?.status || null,
            amount: contrib?.amount || null,
            isBeneficiary: c.beneficiaryParticipantId === participantId,
        };
    });
    return { totalPaid, totalOwed, rows };
}

// Détail par cycle, participant par participant — pour répondre depuis l'autre sens
// (« dans ce cycle, qui a payé combien ? ») sans devoir rouvrir la fiche de chaque membre
// un par un. `participants` doit être group.participants (pas activeParticipants) : un
// membre parti depuis a quand même pu cotiser pendant ce cycle-là.
function computeCycleBreakdown(cycle: any, participants: any[]) {
    return (cycle.contributions || []).map((contrib: any) => {
        const participant = participants.find((p: any) => p.id === contrib.participantId);
        return {
            participantId: contrib.participantId,
            name: participant?.user?.name || 'Membre parti',
            status: contrib.status,
            amount: contrib.amount,
            isBeneficiary: cycle.beneficiaryParticipantId === contrib.participantId,
        };
    });
}

export default function TontineDetailScreen() {
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const COLORS = useAppTheme();
    const styles = getStyles(COLORS);
    const { user } = useAuth();
    const { id } = useLocalSearchParams<{ id: string }>();

    const [group, setGroup] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const [showInviteForm, setShowInviteForm] = useState(false);
    const [exportingReport, setExportingReport] = useState(false);
    const [votingRenewal, setVotingRenewal] = useState(false);
    const [contributing, setContributing] = useState(false);
    const [contributeAmount, setContributeAmount] = useState('');
    const [selectedParticipant, setSelectedParticipant] = useState<any>(null);
    const [selectedCycle, setSelectedCycle] = useState<any>(null);

    // Refs synchrones anti double-tap (même pattern que vault-detail.tsx) : deux appuis
    // rapides peuvent tous deux lire `contributing`/`votingRenewal` avant que le premier
    // `setContributing`/`setVotingRenewal` n'ait été commité par React. Pour le vote, un
    // second tap sur le bouton OPPOSÉ (YES puis NO juste après) avant que le premier ne
    // désactive les deux boutons ferait dépendre le vote final de l'ordre d'arrivée réseau
    // plutôt que du dernier tour réellement voulu par l'utilisateur.
    const contributingRef = useRef(false);
    const votingRenewalRef = useRef(false);
    const reorderingRef = useRef(false);

    const load = useCallback(async (isRefresh = false) => {
        if (!id) return;
        if (isRefresh) setRefreshing(true);
        try {
            const res = await apiGetTontineDetails(id);
            if (res.success) setGroup(res.data);
        } catch (e: any) {
            Alert.alert('Erreur', e.message || 'Impossible de charger le club.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [id]);

    useFocusEffect(useCallback(() => { load(); }, [load]));

    const handleInvite = async (formattedPhone: string) => {
        try {
            await apiInviteToTontine(id, formattedPhone);
            setShowInviteForm(false);
            load();
        } catch (e: any) {
            Alert.alert('Échec de l\'invitation', e.message || 'Une erreur est survenue.');
        }
    };

    // Cotisation volontaire pour le tour en cours (routes/tontine.ts, POST /contribute) —
    // avant, seul le CRON quotidien débitait, sans aucune action possible ici.
    const handleContribute = async () => {
        if (contributingRef.current) return;
        // Champ vide = tout régler d'un coup (le solde restant dû du moment) ; sinon montant
        // libre saisi par l'utilisateur — payer en plusieurs fois est désormais possible.
        const raw = contributeAmount.trim().replace(/\s/g, '').replace(',', '.');
        const amount = raw ? Number(raw) : myRemaining;
        if (!amount || amount <= 0 || Number.isNaN(amount)) {
            Alert.alert('Montant invalide', 'Indiquez un montant à cotiser supérieur à zéro.');
            return;
        }
        if (amount > myRemaining) {
            Alert.alert('Montant trop élevé', `Il ne vous reste que ${myRemaining.toLocaleString('fr-FR')} FCFA à cotiser pour ce tour.`);
            return;
        }
        contributingRef.current = true;
        setContributing(true);
        try {
            const res = await apiContributeTontine(id, amount);
            Alert.alert(res.payoutTriggered ? 'Cagnotte versée ! 🎉' : 'Cotisation enregistrée', res.message);
            setContributeAmount('');
            load();
        } catch (e: any) {
            Alert.alert('Échec', e.message || 'Impossible de cotiser.');
        } finally {
            contributingRef.current = false;
            setContributing(false);
        }
    };

    // Répond au sondage de relance ouvert en fin de boucle (group.status PENDING_RENEWAL,
    // voir tontineService.ts resolveRenewalPoll côté serveur) — celui-ci tranche seul dès
    // que tout le monde a répondu, pas besoin de le déclencher depuis l'app.
    const handleVoteRenewal = async (vote: 'YES' | 'NO') => {
        if (votingRenewalRef.current) return;
        votingRenewalRef.current = true;
        setVotingRenewal(true);
        try {
            await apiVoteTontineRenewal(id, vote);
            load();
        } catch (e: any) {
            Alert.alert('Échec', e.message || 'Impossible d\'enregistrer votre réponse.');
        } finally {
            votingRenewalRef.current = false;
            setVotingRenewal(false);
        }
    };

    const handleReorder = async (participantId: string, direction: 'UP' | 'DOWN') => {
        // Même garde synchrone que handleContribute/handleVoteRenewal ci-dessus : deux appuis
        // rapides (haut puis bas, ou deux fois de suite) avant que `load()` n'ait rafraîchi
        // l'ordre local enverraient chacun un orderMap calculé sur le même instantané périmé.
        if (reorderingRef.current) return;
        const activeList = group.participants.filter((p: any) => p.status === 'ACTIVE');
        const index = activeList.findIndex((p: any) => p.id === participantId);
        if (index < 0) return;
        const swapWith = direction === 'UP' ? index - 1 : index + 1;
        if (swapWith < 0 || swapWith >= activeList.length) return;

        const orderMap = [
            { participantId: activeList[index].id, newOrder: activeList[swapWith].payoutOrder },
            { participantId: activeList[swapWith].id, newOrder: activeList[index].payoutOrder },
        ];
        reorderingRef.current = true;
        try {
            await apiReorderTontine(id, orderMap);
            load();
        } catch (e: any) {
            Alert.alert('Échec', e.message || 'Impossible de réorganiser.');
        } finally {
            reorderingRef.current = false;
        }
    };

    // Réutilise l'endpoint /tontine/reorder existant (déjà validé côté serveur : entiers
    // positifs, pas de doublon, IDOR-checké) avec un ordre calculé côté client — pas besoin
    // de nouvelle route. Restreint à avant le premier cycle : une fois des cagnottes déjà
    // versées, "tirer au sort" l'ordre des membres restants n'a plus le même sens équitable
    // (certains ont déjà eu leur tour, d'autres non) et sort du cas simple traité ici.
    const handleShuffle = () => {
        Alert.alert(
            'Tirage au sort',
            "L'ordre de passage sera réattribué au hasard entre tous les membres, de façon équitable et vérifiable par tous. Continuer ?",
            [
                { text: 'Annuler', style: 'cancel' },
                {
                    text: 'Tirer au sort', onPress: async () => {
                        const shuffled = [...activeParticipants];
                        for (let i = shuffled.length - 1; i > 0; i--) {
                            const j = Math.floor(Math.random() * (i + 1));
                            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
                        }
                        const orderMap = shuffled.map((p: any, idx: number) => ({ participantId: p.id, newOrder: idx + 1 }));
                        try {
                            await apiReorderTontine(id, orderMap);
                            // Confirmation explicite du résultat — avant ce correctif, la liste se
                            // réordonnait silencieusement et rien n'indiquait que le tirage avait
                            // eu lieu ni ce qu'il avait donné.
                            const newOrderNames = shuffled.map((p: any) => p.user.name).join(' —  ');
                            Alert.alert('Tirage effectué', `Nouvel ordre : ${newOrderNames}`);
                            load();
                        } catch (e: any) {
                            Alert.alert('Échec', e.message || 'Impossible de tirer au sort.');
                        }
                    }
                },
            ]
        );
    };

    // Aucun cadre légal ne protège les tontines nulle part (recherche menée sur le sujet) —
    // ce relevé imprimable est le seul « recours » concret qui existe en cas de litige :
    // une preuve datée et vérifiable de qui a cotisé et qui a touché la cagnotte, à chaque
    // cycle. Même mécanisme que le QR marchand (receive-qr.tsx) : génère un PDF via
    // expo-print puis ouvre la feuille de partage native.
    const handleExportReport = async () => {
        if (exportingReport) return;
        setExportingReport(true);
        try {
            const rows = cycles.slice().reverse().map((c: any) => {
                const beneficiary = group.participants.find((p: any) => p.id === c.beneficiaryParticipantId);
                return `<tr>
                    <td>#${c.cycleNumber}</td>
                    <td>${new Date(c.executedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                    <td>${beneficiary ? beneficiary.user.name : '—'}</td>
                    <td>${c.totalCollected.toLocaleString('fr-FR')} FCFA</td>
                    <td>${c.status === 'COMPLETED' ? 'Complet' : 'Partiel (échecs)'}</td>
                </tr>`;
            }).join('');

            const html = `
                <html>
                <head>
                    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
                    <style>
                        body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; padding: 30px; color: #1a1d2e; }
                        h1 { font-size: 20px; color: #10B981; margin-bottom: 4px; }
                        .meta { color: #64748b; font-size: 13px; margin-bottom: 4px; }
                        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                        th, td { border: 1px solid #e2e8f0; padding: 8px 10px; font-size: 13px; text-align: left; }
                        th { background: #f8fafc; }
                    </style>
                </head>
                <body>
                    <h1>MONGAIN — Relevé de tontine</h1>
                    <div class="meta"><b>${group.name}</b> — ${group.contribution.toLocaleString('fr-FR')} FCFA par personne, ${group.frequency === 'MONTHLY' ? 'mensuel' : 'hebdomadaire'}</div>
                    <div class="meta">Généré le ${new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
                    <table>
                        <thead><tr><th>Cycle</th><th>Date</th><th>Bénéficiaire</th><th>Montant collecté</th><th>Statut</th></tr></thead>
                        <tbody>${rows || '<tr><td colspan="5">Aucun cycle exécuté pour l\'instant.</td></tr>'}</tbody>
                    </table>
                </body>
                </html>
            `;

            const { uri } = await Print.printToFileAsync({ html, base64: false });
            await Sharing.shareAsync(uri, {
                mimeType: 'application/pdf',
                dialogTitle: 'Relevé de tontine',
                UTI: 'com.adobe.pdf',
            });
        } catch (error) {
            Alert.alert('Erreur', "Impossible de générer le relevé.");
        } finally {
            setExportingReport(false);
        }
    };

    // Annonce le montant AVANT de demander confirmation plutôt qu'après coup (le serveur,
    // lui, prélève réellement ce montant — voir POST /tontine/leave — cette estimation
    // client ne fait que l'annoncer en amont pour éviter la mauvaise surprise). Un membre
    // ayant déjà touché sa cagnotte doit le solde envers ceux qui n'ont pas encore eu leur
    // tour ; ce calcul reproduit exactement la même règle côté serveur.
    const handleLeave = () => {
        // group.participants (pas activeParticipants, filtré ACTIVE) : un membre mis en pause
        // individuellement (iAmPaused) doit rester trouvable ici — sinon `me` est toujours
        // undefined pour lui et cette estimation annonce "aucune dette" quel que soit son
        // vrai payoutOrder, alors que POST /tontine/leave (sans filtre de statut) lui
        // prélèvera quand même la dette réelle si son tour est déjà passé.
        const me = myParticipant;
        // group.status === 'ACTIVE' : un club dissous (POST /cancel) n'exécutera plus jamais
        // aucun cycle, donc POST /tontine/leave ne prélève alors AUCUNE dette (voir le
        // commentaire serveur : "réclamer une dette ... n'aurait ici aucun moyen d'être un
        // jour reversée à qui que ce soit"). Cette condition manquait ici : l'estimation
        // annonçait un prélèvement fictif à un membre quittant un club déjà dissous, alors
        // que le serveur n'allait rien lui prélever du tout.
        const alreadyPaidOut = group.status === 'ACTIVE' && me && me.payoutOrder < group.currentCycle;
        const remainingBeneficiaries = alreadyPaidOut
            ? activeParticipants.filter((p: any) => p.payoutOrder >= group.currentCycle && p.userId !== user?.id).length
            : 0;
        const estimatedDebt = remainingBeneficiaries * group.contribution;

        Alert.alert(
            'Quitter le club',
            estimatedDebt > 0
                ? `Vous avez déjà reçu la cagnotte de ce club. Quitter maintenant prélèvera automatiquement ${estimatedDebt.toLocaleString('fr-FR')} FCFA de votre solde — votre part envers les ${remainingBeneficiaries} membre${remainingBeneficiaries > 1 ? 's' : ''} qui n'ont pas encore eu leur tour.`
                : `Voulez-vous vraiment quitter « ${group.name} » ? Vous ne serez plus prélevé aux prochains cycles.`,
            [
                { text: 'Annuler', style: 'cancel' },
                {
                    text: 'Quitter', style: 'destructive', onPress: async () => {
                        try {
                            await apiLeaveTontine(id);
                            router.back();
                        } catch (e: any) {
                            Alert.alert('Impossible de quitter', e.message || 'Une erreur est survenue.');
                        }
                    }
                },
            ]
        );
    };

    if (loading || !group) {
        return (
            <SafeAreaView style={[styles.safeArea, { backgroundColor: COLORS.primary }]} edges={['top', 'left', 'right']}>
                <View style={styles.centerFill}><ActivityIndicator color="#fff" size="large" /></View>
            </SafeAreaView>
        );
    }

    const activeParticipants = group.participants.filter((p: any) => p.status === 'ACTIVE').sort((a: any, b: any) => a.payoutOrder - b.payoutOrder);
    const isCreator = group.creatorId === user?.id;
    // Un participant mis en pause individuellement (admin.tontines.ts, pas une pause de
    // groupe entier) disparaît de `activeParticipants` — sans ce repère, la personne
    // concernée ouvrirait son club et ne s'y verrait simplement plus, sans comprendre
    // pourquoi ni que c'est une action volontaire de l'administration.
    const myParticipant = group.participants.find((p: any) => p.userId === user?.id);
    const iAmPaused = myParticipant?.status === 'PAUSED';
    const cagnotte = group.contribution * activeParticipants.length;
    const cycles = group.cycles || [];
    const currentCycleLedger = cycles.find((c: any) => c.cycleNumber === group.currentCycle);
    // `amount` est un CUMUL (voir tontineService.ts) : un membre peut cotiser en plusieurs
    // dépôts d'un montant libre plutôt que payer sa part en une fois.
    const contributionByParticipant: Record<string, { status: string; amount: number }> = {};
    (currentCycleLedger?.contributions || []).forEach((c: any) => { contributionByParticipant[c.participantId] = { status: c.status, amount: c.amount }; });
    const myContribution = myParticipant ? contributionByParticipant[myParticipant.id] : undefined;
    const myAmountPaid = myContribution?.amount || 0;
    const myRemaining = Math.max(0, group.contribution - myAmountPaid);
    // Jusqu'ici, seul le CRON quotidien (cron.ts) pouvait prélever une cotisation, et pour le
    // montant fixe et entier de la part — aucune action n'était possible côté membre.
    const canContribute = !!myParticipant && myParticipant.status === 'ACTIVE' && group.status === 'ACTIVE' && !group.isPaused && myRemaining > 0;

    // Même formule que le CRON (backend/src/cron.ts) : le prochain passage déclenche le
    // cycle dès que ${cycleDays} jours se sont écoulés depuis le dernier versement (ou la
    // création du groupe s'il n'y en a jamais eu) — pas un jour calendaire fixe. Reste
    // valable même après un versement bloqué (PAYOUT_FAILED) : lastPayoutDate a déjà avancé
    // au moment de la tentative, donc cette date est bien celle de la prochaine relance
    // automatique, pas seulement d'un cycle "normal".
    const cycleDays = group.frequency === 'WEEKLY' ? 7 : 30;
    const referenceDate = new Date(group.lastPayoutDate || group.startDate);
    const nextPayoutDate = new Date(referenceDate.getTime() + cycleDays * 24 * 60 * 60 * 1000);

    return (
        <SafeAreaView style={[styles.safeArea, { backgroundColor: COLORS.primary }]} edges={['top', 'left', 'right']}>
            <ScreenHeader
                title={group.name}
                onBack={() => router.back()}
                rightIcon={isCreator ? 'settings-outline' : undefined}
                onRightPress={isCreator ? () => router.push({ pathname: '/tontine-settings', params: { id } }) : undefined}
            />

            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={[styles.content, { backgroundColor: COLORS.background }]}>
                <ScrollView
                    contentContainerStyle={styles.scrollContent}
                    keyboardShouldPersistTaps="handled"
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={COLORS.primary} />}
                >

                    <BalanceCard
                        colors={COLORS}
                        label="Cagnotte par cycle"
                        amount={`${cagnotte.toLocaleString('fr-FR')} FCFA`}
                        description={
                            group.isPaused || group.status === 'PENDING_RENEWAL'
                                ? `${group.contribution.toLocaleString('fr-FR')} FCFA par personne · ${group.frequency === 'MONTHLY' ? 'mensuel' : 'hebdomadaire'} · cycle ${group.currentCycle}`
                                : `${group.contribution.toLocaleString('fr-FR')} FCFA par personne · ${group.frequency === 'MONTHLY' ? 'mensuel' : 'hebdomadaire'} · prochain versement le ${nextPayoutDate.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long' })}`
                        }
                    />

                    {canContribute ? (
                        <View style={[styles.contributeCard, { backgroundColor: COLORS.surface, borderColor: COLORS.border }]}>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                                <Text style={{ color: COLORS.textSecondary, fontSize: 12.5 }}>
                                    {myAmountPaid > 0 ? `Déjà versé : ${myAmountPaid.toLocaleString('fr-FR')} FCFA` : 'Votre part pour ce tour'}
                                </Text>
                                <Text style={{ color: COLORS.textPrimary, fontFamily: 'Satoshi-SemiBold', fontWeight: '700', fontSize: 13 }}>Reste : {myRemaining.toLocaleString('fr-FR')} FCFA</Text>
                            </View>
                            <View style={{ flexDirection: 'row', gap: 8 }}>
                                <TextInput
                                    style={[styles.contributeInput, { borderColor: COLORS.border, color: COLORS.textPrimary, backgroundColor: COLORS.background }]}
                                    keyboardType="numeric"
                                    placeholder={myRemaining.toLocaleString('fr-FR')}
                                    placeholderTextColor={COLORS.textSecondary}
                                    value={contributeAmount}
                                    onChangeText={setContributeAmount}
                                />
                                <TouchableOpacity style={[styles.contributeBtn, { backgroundColor: COLORS.primary, opacity: contributing ? 0.6 : 1 }]} onPress={handleContribute} disabled={contributing}>
                                    {contributing ? <ActivityIndicator color="#fff" /> : (
                                        <>
                                            <Ionicons name="cash-outline" size={16} color="#fff" />
                                            <Text style={styles.contributeBtnText}>Cotiser</Text>
                                        </>
                                    )}
                                </TouchableOpacity>
                            </View>
                            <Text style={{ color: COLORS.textSecondary, fontSize: 11.5, marginTop: 8 }}>
                                Montant libre — laissez vide pour tout régler d'un coup, ou cotisez en plusieurs fois avant la date prévue.
                            </Text>
                        </View>
                    ) : myParticipant?.status === 'ACTIVE' && group.status === 'ACTIVE' && myRemaining === 0 && (
                        // group.status === 'ACTIVE' (comme canContribute plus haut) : sans cette
                        // condition, une cotisation complète juste avant la bascule en
                        // PENDING_RENEWAL laissait ce bandeau "en attente des autres membres"
                        // affiché EN MÊME TEMPS que le sondage de relance ci-dessous — l'attente
                        // réelle porte alors sur les votes, pas sur d'hypothétiques cotisations.
                        <View style={[styles.howItWorksBox, { backgroundColor: COLORS.success + '12' }]}>
                            <Ionicons name="checkmark-circle" size={18} color={COLORS.success} style={{ marginRight: 8 }} />
                            <Text style={[styles.howItWorksText, { color: COLORS.success }]}>Vous avez déjà cotisé pour ce tour — en attente des autres membres.</Text>
                        </View>
                    )}

                    {group.status === 'PENDING_RENEWAL' && (
                        <View style={[styles.howItWorksBox, { backgroundColor: COLORS.primary + '12' }]}>
                            <Ionicons name="repeat" size={18} color={COLORS.primary} style={{ marginRight: 8 }} />
                            <View style={{ flex: 1 }}>
                                <Text style={[styles.howItWorksText, { color: COLORS.primary }]}>
                                    Ce club a terminé sa rotation — tout le monde a reçu sa cagnotte. Voulez-vous relancer une nouvelle boucle ?
                                    {group.renewalDeadline ? ` Répondez avant le ${new Date(group.renewalDeadline).toLocaleDateString('fr-FR')}.` : ''}
                                </Text>
                                {iAmPaused ? (
                                    // Un membre en pause individuelle reste `renewalVote: null` pour
                                    // toujours (resolveRenewalPoll ne concerne que les ACTIVE) — sans ce
                                    // garde, il verrait des boutons de vote bien réels qui échouent
                                    // systématiquement (POST /renewal-vote exige status ACTIVE, voir
                                    // tontine.ts) avec un message d'erreur sans rapport ("vous ne faites
                                    // pas partie de ce club").
                                    <Text style={[styles.howItWorksText, { color: COLORS.primary, fontFamily: 'Satoshi-SemiBold', fontWeight: '700', marginTop: 8 }]}>
                                        Vous êtes en pause dans ce club — vous ne participez pas à ce vote de relance.
                                    </Text>
                                ) : myParticipant?.renewalVote ? (
                                    <Text style={[styles.howItWorksText, { color: COLORS.primary, fontFamily: 'Satoshi-SemiBold', fontWeight: '700', marginTop: 8 }]}>
                                        Votre réponse : {myParticipant.renewalVote === 'YES' ? 'je continue ✓' : 'je ne continue pas'} — en attente des autres membres.
                                    </Text>
                                ) : (
                                    <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                                        <TouchableOpacity
                                            style={[styles.renewalVoteBtn, { backgroundColor: COLORS.primary, opacity: votingRenewal ? 0.6 : 1 }]}
                                            onPress={() => handleVoteRenewal('YES')}
                                            disabled={votingRenewal}
                                        >
                                            {votingRenewal ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.renewalVoteBtnText}>Je continue</Text>}
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            style={[styles.renewalVoteBtn, { backgroundColor: COLORS.error, opacity: votingRenewal ? 0.6 : 1 }]}
                                            onPress={() => handleVoteRenewal('NO')}
                                            disabled={votingRenewal}
                                        >
                                            {votingRenewal ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.renewalVoteBtnText}>Je ne continue pas</Text>}
                                        </TouchableOpacity>
                                    </View>
                                )}
                            </View>
                        </View>
                    )}

                    {group.isPaused && (
                        <View style={[styles.howItWorksBox, { backgroundColor: COLORS.error + '12' }]}>
                            <Ionicons name="pause-circle" size={18} color={COLORS.error} style={{ marginRight: 8 }} />
                            <Text style={[styles.howItWorksText, { color: COLORS.error }]}>
                                Cette tontine est en pause par l'administration{group.pausedReason ? ` (${group.pausedReason})` : ''}. Aucune cotisation ni versement n'aura lieu tant qu'elle n'est pas reprise.
                            </Text>
                        </View>
                    )}

                    {iAmPaused && !group.isPaused && (
                        <View style={[styles.howItWorksBox, { backgroundColor: COLORS.warning + '12' }]}>
                            <Ionicons name="pause-circle" size={18} color={COLORS.warning} style={{ marginRight: 8 }} />
                            <Text style={[styles.howItWorksText, { color: COLORS.warning }]}>
                                Vous avez été mis en pause par l'administration de ce club — vous n'apparaissez plus dans l'ordre de passage, vous ne serez plus prélevé ni sélectionné pour recevoir la cagnotte tant que vous n'êtes pas repris.
                            </Text>
                        </View>
                    )}

                    <View style={[styles.howItWorksBox, { backgroundColor: COLORS.primary + '10' }]}>
                        <Ionicons name="information-circle" size={18} color={COLORS.primary} style={{ marginRight: 8 }} />
                        <Text style={[styles.howItWorksText, { color: COLORS.textSecondary }]}>
                            Cotisez quand vous voulez avec le bouton ci-dessus, ou laissez faire : chaque {group.frequency === 'MONTHLY' ? 'mois' : 'semaine'}, le prélèvement se fait automatiquement pour ceux qui n'ont pas encore payé. La cagnotte part dès que tout le monde a cotisé — automatiquement à la personne dont c'est le tour, jamais deux fois, jamais entre les mains d'un particulier.
                        </Text>
                    </View>

                    <SectionHeading
                        colors={COLORS}
                        title={`Ordre de passage (${activeParticipants.length})`}
                        marginBottom={0}
                        actionIcon={isCreator ? (showInviteForm ? 'chevron-up' : 'person-add-outline') : undefined}
                        onAction={isCreator ? () => setShowInviteForm(!showInviteForm) : undefined}
                    />

                    {showInviteForm && <InlineInviteForm colors={COLORS} onInvite={handleInvite} style={{ marginTop: 12 }} />}

                    {isCreator && cycles.length === 0 && activeParticipants.length > 1 && (
                        <TouchableOpacity style={[styles.shuffleBtn, { borderColor: COLORS.primary }]} onPress={handleShuffle}>
                            <Ionicons name="shuffle" size={16} color={COLORS.primary} />
                            <Text style={{ color: COLORS.primary, fontSize: 12.5, fontFamily: 'Satoshi-SemiBold', fontWeight: '700', marginLeft: 6 }}>Tirage au sort équitable</Text>
                        </TouchableOpacity>
                    )}

                    <View style={[styles.card, { backgroundColor: COLORS.surface, borderColor: COLORS.border, padding: 6 }]}>
                        {activeParticipants.map((p: any, idx: number) => {
                            const isMe = p.userId === user?.id;
                            const isCurrentTurn = p.payoutOrder === group.currentCycle;
                            const isPast = p.payoutOrder < group.currentCycle;
                            const contribution = contributionByParticipant[p.id];
                            const paidAmount = contribution?.amount || 0;
                            const isComplete = paidAmount >= group.contribution;
                            const rel = computeReliability(p.id, cycles);
                            return (
                                <TouchableOpacity key={p.id} activeOpacity={0.7} onPress={() => setSelectedParticipant(p)} style={[styles.memberRow, { borderColor: COLORS.border }, isMe && { backgroundColor: COLORS.primary + '08' }]}>
                                    <View style={[styles.orderCircle, { backgroundColor: isCurrentTurn ? COLORS.primary : COLORS.border }, isPast && { opacity: 0.5 }]}>
                                        {isPast ? <Ionicons name="checkmark" size={14} color={COLORS.textPrimary} /> : <Text style={{ color: isCurrentTurn ? '#fff' : COLORS.textPrimary, fontSize: 12, fontFamily: 'Satoshi-SemiBold', fontWeight: '800' }}>{p.payoutOrder}</Text>}
                                    </View>
                                    <View style={{ flex: 1, marginLeft: 12 }}>
                                        <Text style={{ color: COLORS.textPrimary, fontFamily: 'Satoshi-SemiBold', fontWeight: '600' }}>{p.user.name}{isMe ? ' (Vous)' : ''}</Text>
                                        <Text style={{ color: COLORS.textSecondary, fontSize: 12.5, marginTop: 2 }}>{p.user.phone}</Text>
                                        {/* Visible directement, sans avoir à cliquer : le statut du tour en cours
                                            (montant inclus), l'info la plus consultée au quotidien. Le clic reste
                                            nécessaire seulement pour l'historique complet (voir la modale). Chacun
                                            pouvant cotiser en plusieurs dépôts d'un montant libre (voir bouton
                                            "Cotiser"), ce montant est un CUMUL, pas un simple oui/non. */}
                                        <Text style={{ color: isComplete ? COLORS.success : paidAmount > 0 ? COLORS.warning : COLORS.textSecondary, fontSize: 12, fontFamily: 'Satoshi-SemiBold', fontWeight: '700', marginTop: 3 }}>
                                            Ce tour : {isComplete
                                                ? `versé · ${group.contribution.toLocaleString('fr-FR')} FCFA`
                                                : paidAmount > 0
                                                    ? `${paidAmount.toLocaleString('fr-FR')} / ${group.contribution.toLocaleString('fr-FR')} FCFA versés`
                                                    : 'en attente'}
                                        </Text>
                                    </View>
                                    {rel.total > 0 && (
                                        <View style={[styles.statusPill, { backgroundColor: (rel.paid === rel.total ? COLORS.success : COLORS.warning) + '18' }]}>
                                            <Text style={{ color: rel.paid === rel.total ? COLORS.success : COLORS.warning, fontSize: 10.5, fontFamily: 'Satoshi-SemiBold', fontWeight: '700' }}>{rel.paid}/{rel.total}</Text>
                                        </View>
                                    )}
                                    {isCreator && (
                                        <View style={{ flexDirection: 'row', gap: 6 }}>
                                            {idx > 0 && (
                                                <TouchableOpacity style={[styles.sortBtn, { backgroundColor: COLORS.background }]} onPress={() => handleReorder(p.id, 'UP')}>
                                                    <Ionicons name="chevron-up" size={16} color={COLORS.textSecondary} />
                                                </TouchableOpacity>
                                            )}
                                            {idx < activeParticipants.length - 1 && (
                                                <TouchableOpacity style={[styles.sortBtn, { backgroundColor: COLORS.background }]} onPress={() => handleReorder(p.id, 'DOWN')}>
                                                    <Ionicons name="chevron-down" size={16} color={COLORS.textSecondary} />
                                                </TouchableOpacity>
                                            )}
                                        </View>
                                    )}
                                </TouchableOpacity>
                            );
                        })}
                    </View>

                    <SectionHeading
                        colors={COLORS}
                        title={`Historique des cycles (${cycles.length})`}
                        marginTop={22}
                        actionIcon={cycles.length > 0 ? (exportingReport ? undefined : 'download-outline') : undefined}
                        onAction={cycles.length > 0 ? handleExportReport : undefined}
                    />
                    {cycles.length === 0 ? (
                        <View style={[styles.card, { backgroundColor: COLORS.surface, borderColor: COLORS.border }]}>
                            <Text style={{ color: COLORS.textSecondary, fontSize: 13, lineHeight: 19 }}>Aucun cycle exécuté pour l'instant.</Text>
                        </View>
                    ) : (
                        <View style={[styles.card, { backgroundColor: COLORS.surface, borderColor: COLORS.border, padding: 6 }]}>
                            {cycles.map((c: any) => {
                                const beneficiary = group.participants.find((p: any) => p.id === c.beneficiaryParticipantId);
                                return (
                                    <TouchableOpacity key={c.id} activeOpacity={0.7} onPress={() => setSelectedCycle(c)} style={[styles.memberRow, { borderColor: COLORS.border }]}>
                                        <View style={{ flex: 1 }}>
                                            <Text style={{ color: COLORS.textPrimary, fontFamily: 'Satoshi-SemiBold', fontWeight: '600' }}>Cycle #{c.cycleNumber}{beneficiary ? ` — ${beneficiary.user.name}` : ''}</Text>
                                            <Text style={{ color: COLORS.textSecondary, fontSize: 12.5, marginTop: 2 }}>
                                                {new Date(c.executedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })} · {c.totalCollected.toLocaleString('fr-FR')} FCFA collectés
                                            </Text>
                                        </View>
                                        {c.status === 'PAYOUT_FAILED' ? (
                                            <View style={[styles.contributionBadge, { backgroundColor: COLORS.error + '18' }]}>
                                                <Text style={{ color: COLORS.error, fontSize: 10.5, fontFamily: 'Satoshi-SemiBold', fontWeight: '700' }}>Versement bloqué</Text>
                                            </View>
                                        ) : c.status === 'PARTIAL' && (
                                            <View style={[styles.contributionBadge, { backgroundColor: COLORS.warning + '18' }]}>
                                                <Text style={{ color: COLORS.warning, fontSize: 10.5, fontFamily: 'Satoshi-SemiBold', fontWeight: '700' }}>Échecs</Text>
                                            </View>
                                        )}
                                        <Ionicons name="chevron-forward" size={16} color={COLORS.textSecondary} style={{ marginLeft: 8 }} />
                                    </TouchableOpacity>
                                );
                            })}
                        </View>
                    )}

                    <TouchableOpacity style={styles.leaveBtn} onPress={handleLeave}>
                        <Ionicons name="exit-outline" size={18} color={COLORS.error} />
                        <Text style={[styles.leaveBtnText, { color: COLORS.error }]}>Quitter ce club</Text>
                    </TouchableOpacity>
                </ScrollView>
                <View style={{ height: Math.max(insets.bottom, 20) }} />
            </KeyboardAvoidingView>

            <Modal visible={!!selectedParticipant} transparent animationType="fade" onRequestClose={() => setSelectedParticipant(null)}>
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalCard, { backgroundColor: COLORS.surface }]}>
                        {selectedParticipant && (() => {
                            const ledger = computeParticipantLedger(selectedParticipant.id, cycles, group.contribution);
                            return (
                                <>
                                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                        <View style={{ flex: 1 }}>
                                            <Text style={{ color: COLORS.textPrimary, fontFamily: 'Satoshi-SemiBold', fontWeight: '700', fontSize: 16 }}>{selectedParticipant.user.name}</Text>
                                            <Text style={{ color: COLORS.textSecondary, fontSize: 12.5, marginTop: 2 }}>{selectedParticipant.user.phone}</Text>
                                        </View>
                                        <TouchableOpacity onPress={() => setSelectedParticipant(null)}>
                                            <Ionicons name="close" size={22} color={COLORS.textSecondary} />
                                        </TouchableOpacity>
                                    </View>

                                    <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                                        <View style={[styles.ledgerSummaryBox, { backgroundColor: COLORS.success + '12' }]}>
                                            <Text style={{ color: COLORS.textSecondary, fontSize: 11 }}>Total versé</Text>
                                            <Text style={{ color: COLORS.success, fontFamily: 'Satoshi-SemiBold', fontWeight: '700', fontSize: 16, marginTop: 2 }}>{ledger.totalPaid.toLocaleString('fr-FR')} FCFA</Text>
                                        </View>
                                        {ledger.totalOwed > 0 && (
                                            <View style={[styles.ledgerSummaryBox, { backgroundColor: COLORS.error + '12' }]}>
                                                <Text style={{ color: COLORS.textSecondary, fontSize: 11 }}>Total dû</Text>
                                                <Text style={{ color: COLORS.error, fontFamily: 'Satoshi-SemiBold', fontWeight: '700', fontSize: 16, marginTop: 2 }}>{ledger.totalOwed.toLocaleString('fr-FR')} FCFA</Text>
                                            </View>
                                        )}
                                    </View>

                                    <Text style={{ color: COLORS.textSecondary, fontSize: 12, fontFamily: 'Satoshi-SemiBold', fontWeight: '700', textTransform: 'uppercase', marginTop: 18, marginBottom: 8 }}>Historique par cycle</Text>
                                    <ScrollView style={{ maxHeight: 260 }}>
                                        {ledger.rows.length === 0 ? (
                                            <Text style={{ color: COLORS.textSecondary, fontSize: 13 }}>Aucun cycle exécuté pour l'instant.</Text>
                                        ) : ledger.rows.map((r) => (
                                            <View key={r.cycleNumber} style={[styles.memberRow, { borderColor: COLORS.border, paddingVertical: 10 }]}>
                                                <Text style={{ color: COLORS.textPrimary, fontSize: 13, fontFamily: 'Satoshi-SemiBold', fontWeight: '600', flex: 1 }}>
                                                    Cycle #{r.cycleNumber}{r.isBeneficiary ? ' 🎉' : ''}
                                                </Text>
                                                {r.status ? (
                                                    <Text style={{ color: r.status === 'PAID' ? COLORS.success : r.status === 'PARTIAL' ? COLORS.warning : COLORS.error, fontSize: 12.5, fontFamily: 'Satoshi-SemiBold', fontWeight: '700' }}>
                                                        {r.status === 'PAID'
                                                            ? `Versé · ${r.amount.toLocaleString('fr-FR')} FCFA`
                                                            : r.status === 'PARTIAL'
                                                                ? `${r.amount.toLocaleString('fr-FR')} versés, doit ${Math.max(0, group.contribution - r.amount).toLocaleString('fr-FR')} FCFA`
                                                                : `Doit ${(r.amount || 0).toLocaleString('fr-FR')} FCFA`}
                                                    </Text>
                                                ) : (
                                                    <Text style={{ color: COLORS.textSecondary, fontSize: 12.5 }}>—</Text>
                                                )}
                                            </View>
                                        ))}
                                    </ScrollView>
                                </>
                            );
                        })()}
                    </View>
                </View>
            </Modal>

            <Modal visible={!!selectedCycle} transparent animationType="fade" onRequestClose={() => setSelectedCycle(null)}>
                <View style={styles.modalOverlay}>
                    <View style={[styles.modalCard, { backgroundColor: COLORS.surface }]}>
                        {selectedCycle && (() => {
                            const breakdown = computeCycleBreakdown(selectedCycle, group.participants);
                            return (
                                <>
                                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                        <View style={{ flex: 1 }}>
                                            <Text style={{ color: COLORS.textPrimary, fontFamily: 'Satoshi-SemiBold', fontWeight: '700', fontSize: 16 }}>Cycle #{selectedCycle.cycleNumber}</Text>
                                            <Text style={{ color: COLORS.textSecondary, fontSize: 12.5, marginTop: 2 }}>
                                                {new Date(selectedCycle.executedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}
                                            </Text>
                                        </View>
                                        <TouchableOpacity onPress={() => setSelectedCycle(null)}>
                                            <Ionicons name="close" size={22} color={COLORS.textSecondary} />
                                        </TouchableOpacity>
                                    </View>

                                    <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                                        <View style={[styles.ledgerSummaryBox, { backgroundColor: COLORS.success + '12' }]}>
                                            <Text style={{ color: COLORS.textSecondary, fontSize: 11 }}>Collecté</Text>
                                            <Text style={{ color: COLORS.success, fontFamily: 'Satoshi-SemiBold', fontWeight: '700', fontSize: 16, marginTop: 2 }}>{selectedCycle.totalCollected.toLocaleString('fr-FR')} FCFA</Text>
                                        </View>
                                        <View style={[styles.ledgerSummaryBox, { backgroundColor: COLORS.background }]}>
                                            <Text style={{ color: COLORS.textSecondary, fontSize: 11 }}>Attendu</Text>
                                            <Text style={{ color: COLORS.textPrimary, fontFamily: 'Satoshi-SemiBold', fontWeight: '700', fontSize: 16, marginTop: 2 }}>{selectedCycle.totalExpected.toLocaleString('fr-FR')} FCFA</Text>
                                        </View>
                                    </View>

                                    <Text style={{ color: COLORS.textSecondary, fontSize: 12, fontFamily: 'Satoshi-SemiBold', fontWeight: '700', textTransform: 'uppercase', marginTop: 18, marginBottom: 8 }}>Cotisation par membre</Text>
                                    <ScrollView style={{ maxHeight: 260 }}>
                                        {breakdown.length === 0 ? (
                                            <Text style={{ color: COLORS.textSecondary, fontSize: 13 }}>Aucune cotisation enregistrée pour ce cycle.</Text>
                                        ) : breakdown.map((b: any) => (
                                            <View key={b.participantId} style={[styles.memberRow, { borderColor: COLORS.border, paddingVertical: 10 }]}>
                                                <Text style={{ color: COLORS.textPrimary, fontSize: 13, fontFamily: 'Satoshi-SemiBold', fontWeight: '600', flex: 1 }}>
                                                    {b.name}{b.isBeneficiary ? ' 🎉' : ''}
                                                </Text>
                                                <Text style={{ color: b.status === 'PAID' ? COLORS.success : b.status === 'PARTIAL' ? COLORS.warning : COLORS.error, fontSize: 12.5, fontFamily: 'Satoshi-SemiBold', fontWeight: '700' }}>
                                                    {b.status === 'PAID'
                                                        ? `Versé · ${b.amount.toLocaleString('fr-FR')} FCFA`
                                                        : b.status === 'PARTIAL'
                                                            ? `${b.amount.toLocaleString('fr-FR')} versés, doit ${Math.max(0, group.contribution - b.amount).toLocaleString('fr-FR')} FCFA`
                                                            : `Doit ${b.amount.toLocaleString('fr-FR')} FCFA`}
                                                </Text>
                                            </View>
                                        ))}
                                    </ScrollView>
                                </>
                            );
                        })()}
                    </View>
                </View>
            </Modal>
        </SafeAreaView>
    );
}

const getStyles = (COLORS: ReturnType<typeof useAppTheme>) => StyleSheet.create({
    safeArea: { flex: 1 },
    centerFill: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    content: { flex: 1, borderTopLeftRadius: 28, borderTopRightRadius: 28 },
    scrollContent: { padding: 20, paddingBottom: 60 },

    card: { borderRadius: 16, borderWidth: 1, padding: 16, marginTop: 12 },
    howItWorksBox: { flexDirection: 'row', alignItems: 'flex-start', borderRadius: 14, padding: 14, marginBottom: 4 },
    howItWorksText: { flex: 1, fontSize: 12.5, lineHeight: 18 },
    renewalVoteBtn: { flex: 1, borderRadius: 10, paddingVertical: 10, alignItems: 'center', justifyContent: 'center', minHeight: 38 },
    renewalVoteBtnText: { color: '#fff', fontFamily: 'Satoshi-SemiBold', fontWeight: '700', fontSize: 13 },
    contributeCard: { borderRadius: 16, borderWidth: 1, padding: 14, marginTop: 4, marginBottom: 4 },
    contributeInput: { flex: 1, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, height: 46, fontSize: 15, fontFamily: 'Satoshi-SemiBold', fontWeight: '600' },
    contributeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, paddingHorizontal: 18, minHeight: 46 },
    contributeBtnText: { color: '#fff', fontFamily: 'Satoshi-SemiBold', fontWeight: '700', fontSize: 14.5 },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 24 },
    modalCard: { borderRadius: 18, padding: 20, maxHeight: '80%' },
    ledgerSummaryBox: { flex: 1, borderRadius: 12, padding: 12 },
    shuffleBtn: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginTop: 12, marginBottom: 4 },

    memberRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 10, borderBottomWidth: 1, borderRadius: 10 },
    orderCircle: { width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center' },
    sortBtn: { width: 30, height: 30, borderRadius: 15, justifyContent: 'center', alignItems: 'center' },
    contributionBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, marginRight: 6 },
    statusPill: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },

    leaveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 32, paddingVertical: 14 },
    leaveBtnText: { fontSize: 14, fontFamily: 'Satoshi-SemiBold', fontWeight: '700' },
});

