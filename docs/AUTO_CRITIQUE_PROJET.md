# Auto-critique du projet Mongain (mise à jour vérifiée)

*Analyse exécutée avec les outils du poste de travail : typecheck, suites de tests, `npm audit`, lecture directe du code, `git blame`/`git show`, et huit revues ciblées au total (deux passes : sécurité/argent générale, puis un balayage exhaustif fichier-par-fichier de tout le backend, tout l'admin-web et tout le mobile). Contrairement à une lecture des messages de commit, chaque constat ci-dessous a été vérifié dans le code ou l'exécution réelle.*

## Verdict

**Mise à jour du 2026-11-01 (revue exhaustive, 6 agents en parallèle, ~71 000 lignes) — le constat le plus grave du document à ce jour :** une revue ligne par ligne de l'intégralité du backend, de l'admin-web, du portail marchand géant et de l'app mobile a trouvé une **faille d'authentification inter-canal confirmée par relecture directe** : un jeton du portail web marchand géant — y compris celui d'un rôle AUDITOR strictement lecture seule — est accepté par `authMiddleware` (celui qui protège quasiment toutes les routes argent du mobile) comme s'il s'agissait du jeton mobile du géant lui-même, parce que ce middleware ne rejette jamais un jeton `portal`/`till` et que son contrôle de version de session se désactive silencieusement en leur absence. Voir section 13.2-A pour le détail et le correctif (une ligne). D'autres constats critiques accompagnent celui-ci : un virement de masse au-dessus du seuil de double validation ne demande aucun PIN (l'inverse de l'effet recherché), une SSRF ouverte via les webhooks marchand, deux écrans entiers d'admin-web totalement non-fonctionnels pour tout le personnel, et aucune clé d'idempotence envoyée par l'app mobile malgré le support serveur généralisé — voir section 13 pour la liste complète.

**Limite méthodologique de cette passe à noter explicitement** (contraire à la règle du document : « vérifié dans le code actuel, pas juste les messages de commit ») : `npx tsc`/`npm test`/`npm run build` n'ont pas pu être exécutés depuis ce poste de travail (Node.js introuvable sur le PATH de la session — environnement local, sans lien avec le code du projet). Les constats de la section 13 reposent donc sur la lecture directe du code par 6 agents spécialisés en parallèle, avec re-vérification manuelle ciblée des constats les plus critiques (A, C) par relecture directe des fichiers sources — mais **sans confirmation par exécution réelle des tests**, contrairement aux passes précédentes. Faire tourner les suites de tests dès que Node.js est disponible est maintenant la première chose à faire (section 10).

**Mise à jour du 2026-09-12 :** quatre des points ouverts ont été corrigés et vérifiés par exécution (typecheck + tests + build, pas seulement relus) :

1. ~~Build admin-web cassé~~ **corrigé le 2026-09-11** (`admin-web/vite.config.ts:10`).
2. ~~Gel SAR qui ne persiste jamais~~ **corrigé** (`backend/src/services/LimitEngine.ts`) : le gel et l'entrée d'audit passent maintenant par le client `prisma` racine, dans une transaction indépendante qui committe avant le `throw` qui bloque l'opération en cours — donc plus jamais annulée par le rollback de la transaction appelante. Test de régression : `LimitEngine.test.ts`.
3. ~~Race condition double-paiement sur `split.ts`~~ **corrigé** : `/pay/:id` réclame maintenant le split via un `updateMany` conditionné sur `status: 'PENDING'` (atomique au niveau SQL) avant tout mouvement de fonds, au lieu d'un couple lecture/écriture non atomique. Tests de régression : `split.test.ts` (nouveau fichier, 4 tests).
4. ~~Virement de masse B2B sans PIN ni idempotence~~ **corrigé** : `POST /api/b2b/payouts` exige maintenant le PIN (comme tous les autres rails de paiement d'un User) et accepte une `idempotencyKey` optionnelle — un lot déjà soumis avec la même clé est retourné tel quel au lieu d'être recréé et retraité. Migration `20260912000000_add_payout_bulk_idempotency_key` (colonne additive, nullable). Frontend (`admin-web/src/B2BHub.tsx`) mis à jour : champ PIN, clé générée côté client et stable le temps d'une tentative, bouton désactivé pendant l'envoi. Tests de régression : `b2b.test.ts` (+4 tests).
5. ~~Fuite d'information sur `GET /settings`~~ **corrigé** : la route publique ne renvoie plus que les 8 champs réellement consultés par l'app mobile avant connexion (tarifs affichés, bascules de fonctionnalité) ; les seuils anti-fraude/KYC, les plafonds par palier et l'allowlist IP admin ne sont plus exposés sans authentification. Nouvelle route `GET /api/settings/full` (staff habilité, `perm_system_settings_view`) pour l'écran d'administration, qui l'utilise désormais avec son jeton au lieu de l'ancien appel public. Tests de régression : `settings.test.ts` (+4 tests).

~~Reste ouvert : le 2FA du personnel est toujours désactivé en dur~~ **corrigé le 2026-09-12** — voir mise à jour ci-dessous.

**Mise à jour du 2026-09-12 (deuxième vague) — honnêteté produit, pas sécurité :** un audit séparé, demandé par le porteur du projet, a établi qu'au moins trois fonctionnalités présentées comme actives à l'utilisateur ne sont connectées à aucun partenaire externe réel : cartes virtuelles (numéro/CVV générés par `Math.random()`, aucun réseau Visa/Mastercard), crypto (taux codé en dur commenté « Mocked... for DEMO », aucune bourse/custodian), et remise internationale (taux codé en dur commenté « Mock Rates for MVP », aucun partenaire de transfert — l'écran affichait pourtant « Transféré ! Fonds expédiés... »). Voir section 9 pour le détail complet et le chemin vers une vraie intégration pour chacune. **Corrigé immédiatement** : les trois sont maintenant désactivées par défaut (retournent 501 avec un message explicite), sur le même modèle que `ENABLE_UNVERIFIED_EXTERNAL_SERVICES` déjà utilisé pour les factures/recharge — voir `backend/.env.example` (`ENABLE_UNVERIFIED_CRYPTO`, `ENABLE_UNVERIFIED_CARDS`, `ENABLE_UNVERIFIED_REMIT`). `/crypto/sell` et `/remit/quote` restent volontairement ouverts (aucun mouvement de fonds nouveau, ou permettent à un utilisateur de sortir d'une position déjà simulée). Tests de régression : `crypto.test.ts` et `remit.test.ts` (nouveaux fichiers), `cards.test.ts` (+2 tests).

**Point non résolu à vérifier manuellement** : ces garde-fous empêchent les *prochaines* utilisations, mais ne corrigent pas les conséquences d'utilisations déjà survenues. Si des clients réels ont déjà acheté de la crypto, émis/rechargé une carte, ou envoyé une remise internationale avant ce correctif, leur argent a été réellement débité pour un service qui n'a rien fait de réel — une vérification des tables `CryptoTransaction`, `VirtualCard`/historique de recharge, et `RemittanceTransaction` est nécessaire pour identifier ces cas et décider d'un remboursement. C'est une décision produit/support, pas quelque chose que ce correctif peut faire à ta place.

**Autre point découvert en creusant les cartes** : même une fois un vrai émetteur connecté, `cards.ts` n'a aujourd'hui *aucune route pour dépenser ou retirer* l'argent chargé sur une carte (`/fund` alimente la carte, rien ne la débite jamais). Tout argent déjà placé sur une carte virtuelle y reste bloqué sans intervention manuelle en base — à corriger avant de rouvrir `ENABLE_UNVERIFIED_CARDS`, indépendamment du choix d'émetteur.

**Mise à jour du 2026-09-12 (troisième vague) — cœur applicatif de Mongain :**

1. ~~2FA du personnel désactivé~~ **corrigé.** `backend/src/routes/corp.ts` restaure le flux OTP retiré par le commit `c2f0981` : `/login` exige à nouveau un téléphone enregistré et envoie un code par SMS (mode démo `1234` uniquement si `isSmsConfigured` est faux, même source de vérité que le reste de l'app) avant de délivrer un jeton via `/verify-login-otp`. Les 2 tests qui documentaient la faille passent maintenant.
2. Arrondis manquants complétés dans `agency.ts`, `gateway.ts`, `invest.ts`, `merchant.ts`, `credit.ts` (le cas le plus grave : aucune conversion numérique du tout), `ussd.ts` (+ correction d'une fuite de message d'erreur brut vers un appelant USSD non authentifié), `bnpl.ts`, `vault.ts`, `crypto.ts`, et `family.ts` (contrainte `.int()` ajoutée au schéma Zod du plafond enfant).
3. Fuseau horaire corrigé dans `LimitEngine.ts` : les remises à zéro des plafonds jour/mois/semaine suivent maintenant `SystemSettings.timezone` (Africa/Libreville par défaut) via un nouvel helper `startOfWeekInTimezone` (miroir de `startOfDayInTimezone`/`startOfMonthInTimezone` déjà existants), au lieu de l'heure locale du serveur (UTC sur Render).
4. CORS : une origine refusée renvoie maintenant `403` explicite au lieu de `500` (`backend/src/index.ts`), sans changer le comportement des autres erreurs qui passent par le même filet de sécurité générique.
5. Rate limiting ajouté sur toutes les routes qui déplacent réellement de l'argent et n'en avaient aucun : `wallet.ts` (transfert, retraits, pay-service, pull), `biller.ts` (`/pay`), `bnpl.ts` (`/apply`, `/repay`), `vault.ts` (dépôt, demande de retrait) — limité par compte (pas par IP, pour ne pas pénaliser le CGNAT partagé des opérateurs mobiles gabonais).
6. Clé d'idempotence ajoutée sur ces mêmes routes (vérification à l'intérieur de la transaction, avant toute écriture, même convention que `CashOperationService`), plus sur `vault.ts` (nouveau champ `VaultTransaction.idempotencyKey`, migration `20260912010000_add_vault_transaction_idempotency_key`).
7. Écarts de permission admin-web corrigés : `Settings.tsx` (12 boutons désormais gatés sur `perm_system_settings_edit`), `SupportCenter.tsx` (statut/escalade de ticket, notes, actions fraude), `BranchDashboard.tsx` (demande de financement, rapport de rapprochement — ce dernier avait déjà un commentaire admettant le bug sans correctif appliqué).

Tests de régression ajoutés à chaque étape (`corp.test.ts`, `LimitEngine.test.ts`, `wallet.test.ts`, `vault.test.ts`, et les fichiers de test admin-web correspondants). État final vérifié par exécution réelle : **backend 751/751 tests, admin-web 186/186 tests, typecheck propre des deux côtés, build admin-web propre.** Zéro régression sur l'ensemble des trois vagues de correctifs de cette session.

Le reste de l'analyse confirme que la base technique est réelle et sérieuse (RBAC, verrous de ligne SQL, migration Float→Int soignée, tests nombreux, webhook PVit correctement sécurisé), mais que le rythme des correctifs n'avait pas été vérifié par exécution avant d'être déclaré « fixé » — d'où plusieurs régressions passées inaperçues malgré des commits qui prétendaient les corriger. La couverture de revue initiale n'était qu'un échantillon ; le balayage exhaustif (section 8) a trouvé des problèmes du même ordre de gravité dans des fichiers jamais regardés jusque-là, et la plupart sont maintenant traités.

## 1. Connexion personnel sans 2FA — ✅ corrigé le 2026-09-12

**Preuve par test qui échoue réellement (`backend`, `npm test`) :**

```
POST /corp/login › bloque la connexion si le compte n'a aucun téléphone enregistré
  Expected: 400   Received: 200

POST /corp/login › envoie un code OTP et renvoie requireOtp — ne délivre jamais le token directement
  Expected: { requireOtp: true, message: Any<String> }
  Received: { token: "eyJhbGci...", user: {...} }
```

**Preuve par le code actuel** (`backend/src/routes/corp.ts:96-119`) : le commentaire explique ce que le code *devrait* faire (exiger un téléphone, envoyer un OTP, ne jamais délivrer de jeton sans lui), puis juste en dessous :

```ts
// --- DÉSACTIVATION TEMPORAIRE DU 2FA ---
const token = jwt.sign({ userId: staff.id, role: staff.role, isCorp: true, jwtVersion: staff.jwtVersion }, JWT_SECRET, { expiresIn: '12h' });
return res.json({ token, user: {...} });
```

**Preuve par `git blame`** : le commit `c2f0981` (*« Desactivation_2FA »*, 2026-09-04 21:47) a supprimé tout le flux (vérification du téléphone, génération de code, envoi SMS, réponse `requireOtp`) qui existait déjà et fonctionnait. `POST /corp/verify-login-otp` et la table `StaffVerificationCode` existent toujours mais ne sont plus jamais atteints — code mort.

**Aggravant** : `admin-web/src/Login.tsx:11-25` a déjà été mis à jour pour *attendre* ce flux (`if (data.requireOtp) setStep('otp')`), avec un commentaire qui raconte qu'un incident réel s'est déjà produit (« le backend avait été redéployé avec le 2FA avant que ce portail ne le soit »). Autrement dit : le 2FA a fonctionné en production à un moment, puis a été retiré côté serveur sans jamais être remis, alors que le portail admin est prêt à le recevoir. Aucun des 4 commits d'aujourd'hui n'a touché ce fichier.

**Action immédiate recommandée :** restaurer le flux OTP de `corp.ts` (l'ancienne version est visible via `git show c2f0981~1:backend/src/routes/corp.ts`) avant toute connexion staff sur un environnement contenant des données réelles.

## 2. Build admin-web cassé — ✅ corrigé le 2026-09-11

`cd admin-web && npm run build` échouait, reproduit deux fois (y compris après purge du cache `tsc -b --force`) :

```
vite.config.ts(10,22): error TS7006: Parameter 'id' implicitly has an 'any' type.
```

Introduit par le commit `c25bb24` (*« chore: harden configuration and build checks »*, ce matin 01:01) qui a ajouté `manualChunks(id) {...}` sans typer `id`, dans un fichier de config cast en `as any` global — le cast ne protège pas le literal object contre le typage de ses paramètres de fonction. `admin-web/vercel.json` a `"buildCommand": "npm run build"` : c'est exactement la commande qui casse. Les 4 commits suivants n'ont pas retesté le build.

**Correctif trivial :** `manualChunks(id: string) {`.

## 3. État vérifié des 4 commits du jour

| Commit | Prétention | Verdict | Preuve |
|---|---|---|---|
| `8007f10` Float→Int | « Math.round() à chaque site de calcul de frais/intérêt » | **Partiel** | La migration SQL elle-même est réelle et prudente (`ROUND(col::numeric)::INTEGER`, taux/ratios et quantités crypto laissés en Float à raison, réconciliation avant/après annoncée). Mais `crypto.ts` (`/buy`, `xafAmount`), `bnpl.ts` (`/apply`, `requestedAmount`), `vault.ts` (`/deposit`, plusieurs sites) utilisent encore `parseFloat`/`Number()` bruts avant d'écrire dans une colonne Int — Prisma lève une exception plutôt que d'accepter un flottant (donc pas de dérive silencieuse, mais un risque de 500 sur montant mal saisi). Même motif dans `agency.ts`, `cards.ts`, `gateway.ts`, `invest.ts`, `split.ts`, `ussd.ts`, `merchant.ts`. |
| `1389ad9` biller/KYC/rounding | « Fuite photo KYC corrigée, paiements biller sécurisés » | **Confirmé** pour ces deux points précis | `admin.ts` (lookup teller) ne renvoie les photos KYC que si `perm_customer_kyc_view` ; les autres routes qui exposent des photos étaient déjà correctement filtrées. `biller.ts` a bien le flag de fonctionnalité, le PIN avec verrouillage, la garde `balance:{gte}` atomique et la vérification `LimitEngine`. |
| `72bfaf0` remit/jest | « Corrige le bug de changement de devise » | **Confirmé** | `remit.ts` `/quote` et `/send` partagent maintenant une seule formule d'arrondi. |
| `70ed64f` permissions admin-web | « L'UI ne montre plus d'actions que le backend refuse toujours » | **Confirmé pour le périmètre touché, incomplet pour le reste** | Voir section 4.3 : le même défaut existe encore dans `Treasury.tsx`, un écran voisin non touché par ce commit. |

## 4. Nouveaux problèmes découverts (par domaine)

### 4.1 Backend — argent et sécurité

- **Aucune clé d'idempotence nulle part** (`grep -i idempoten` → 0 résultat). Les transferts/retraits utilisent un vrai verrou de ligne (`SELECT ... FOR UPDATE` + `balance:{gte}`, `wallet.ts:546-624`), donc pas de double dépense par concurrence — mais une requête réseau rejouée (double-tap, retry client) crée une deuxième transaction réelle si le solde le permet.
- **Aucune route financière n'a de limite de débit dédiée** : seules `auth.ts` (OTP), `corp.ts` (login) et `wallet.ts` (contacts) ont un `express-rate-limit`. Transfert, retrait, biller, remit, coffre, BNPL, crypto, tontine, B2B n'en ont aucune.
- **CORS** : une origine refusée tombe dans le handler d'erreur générique (`index.ts:240-245`) et renvoie `500`, pas `403` — comportement inchangé depuis la précédente critique.
- **Allowlist IP admin** toujours optionnelle par défaut (`adminIpAllowlist.ts:20`), échoue fermé (503) si activée puis en erreur — c'est le bon sens de repli, mais elle reste éteinte par défaut.
- **`ENABLE_UNVERIFIED_EXTERNAL_SERVICES` vaut `true` dans le `backend/.env` local**, alors que `.env.example` le documente à `false`. À vérifier explicitement sur l'environnement Render réel : s'il est à `true` en production, cela réactive tous les flux non vérifiés (biller, services) que le commit `1389ad9` a justement pris soin de neutraliser par ce flag.
- **Incident opérationnel déjà survenu** : la migration `20260828120000_restore_wiped_schema_incident` documente qu'une commande `prisma migrate diff --shadow-database-url` a été lancée par erreur contre la vraie base (le paramètre pointait sur la base réelle au lieu d'une base jetable), réinitialisant le schéma aux seules migrations tracées et perdant les colonnes/tables ajoutées via `db push`. Récupéré via un script additif généré par introspection, relu avant exécution — bonne réaction, mais l'incident lui-même confirme l'absence totale de garde-fou (pas de CI, pas d'environnement de staging séparé, opérations de schéma à la main contre la base de production).

### 4.2 Mobile (Expo SDK 57)

- `src/app/remit.tsx:38` envoie `Number(amountStr)` brut à `/api/remit/quote`, sans le `Math.round(parseFloat(...))` que toutes les autres routes argent utilisent désormais (`withdraw-form.tsx:49`, `bnpl.tsx:29`, `billers.tsx:20`, `vault-detail.tsx:146`) — oublié par le passage de durcissement post-migration.
- `src/app/services/water.tsx:36` et `airtime.tsx:37` envoient aussi `Number(amount)` non arrondi vers un schéma Zod backend qui exige un entier strict (`z.number().int('Pas de centimes.')`) — un copier-coller ou une saisie collée renvoie un 400 sec au lieu d'un arrondi silencieux comme ailleurs.
- **Deux implémentations parallèles de « payer une facture »** : `billers.tsx` appelle `/api/billers/pay` directement via `request()`, `services/water.tsx`/`airtime.tsx` appellent `/api/services/pay-bill` via un autre chemin ; `apiPayBill` (`src/services/api.ts:437`) est défini mais jamais utilisé — code mort, logique dupliquée qui peut diverger dans le temps.
- **Verrou applicatif fragile** : `SecurityWrapper.tsx:18` expose un indicateur global mutable `SecurityFlags.bypassAppLock`, activé pendant `ImagePicker.launchImageLibraryAsync` (`profile-edit.tsx`) et remis à `false` par un `setTimeout(1000)` fixe dans un `finally` — si le sélecteur d'image met plus d'une seconde (galerie volumineuse, appareil lent), la fenêtre de contournement se referme avant la fin réelle du picker ; le code porte déjà la trace d'un bug similaire corrigé une fois (« ne pas laisser à `true` pour toujours »).
- Dépendance dupliquée : `lottie-react-native` (utilisé une fois) et `@lottiefiles/dotlottie-react` (zéro usage trouvé dans `src/`) sont toutes les deux embarquées.
- Aucun test sur les écrans argent les plus sensibles : `transfer.tsx`, `transfer-confirm.tsx`, `remit.tsx`, `vault-detail.tsx`, `bnpl.tsx`, `billers.tsx`, `tontine-*.tsx`.

### 4.3 Admin-web

- **Même défaut que le commit `70ed64f` prétend avoir corrigé, retrouvé ailleurs** : `Treasury.tsx:173` protège l'onglet « Lancer Opération » par un OU sur `perm_treasury_mint`/`perm_treasury_allocate`, mais les quatre types d'opération à l'intérieur (dont la création monétaire, ISSUANCE) sont affichés sans filtre individuel (`Treasury.tsx:431-452`), alors que le backend exige `perm_treasury_mint` spécifiquement pour ISSUANCE (`treasury.ts:142-146`). Un rôle n'ayant que `perm_treasury_allocate` voit et peut remplir le formulaire de création monétaire, puis reçoit un 403 — exactement le symptôme visé par le commit du jour, non couvert par ses tests (`Treasury.test.tsx` ne rend jamais l'écran avec des permissions partielles).
- **Le motif fail-open `hasPerm ? hasPerm([...]) : true` est dupliqué dans 7+ fichiers** (`Accounts.tsx`, `KycMod.tsx`, `Settings.tsx`, `StaffAccessRights.tsx`, `StaffAssignBranch.tsx`, `TellerTerminal.tsx`, `VirtualCards.tsx`) au lieu d'un hook partagé — c'est ce copier-coller qui a laissé passer le cas Treasury et laissera probablement passer le suivant.
- **Correction à la précédente critique** : les jetons ne sont plus dans `localStorage` mais dans `sessionStorage` (`App.tsx:45,76,117`, commentaire explicite « VUL-05 »), avec un accès non persistant, limité à l'onglet, et aucun refresh token côté client. Le risque XSS résiduel existe toujours (pas de CSP trouvée) mais il est réduit par rapport à ce qui avait été précédemment noté.
- Permission orpheline : `perm_customer_suspend` (RBAC.ts:24) est assignable dans la matrice mais son seul point d'usage backend (`/users/:id/logout-all`) n'est jamais appelé depuis aucun écran.
- Hostname de production en dur : `Settings.tsx:678,680` (`https://mongain-backend.onrender.com`) au lieu d'être dérivé de la config.
- Taille de bundle confirmée à l'octet près : `index-*.js` 688 471 o, `pdf-*.js` 630 561 o, `charts-*.js` 417 779 o. `App.tsx` importe statiquement les ~32 écrans, aucun `React.lazy`.

### 4.4 Hygiène de dépôt (mineur)

- `expo_logs.txt` est suivi par git malgré les règles `.gitignore` pour les logs, à cause d'un motif au singulier (`*_log.txt`) qui ne couvre pas le nom réel au pluriel — fichier inoffensif (972 o, pas de secret dedans) mais révèle un trou dans les motifs.
- Aucun pipeline CI (`.github/` absent) : rien n'aurait empêché de fusionner un build cassé ou un test en échec ce matin.

## 5. Résultats des vérifications automatisées (ré-exécutées maintenant)

| Ensemble | Résultat | Détail |
|---|---:|---|
| Mobile `tsc --noEmit` | ✅ 0 erreur | |
| Mobile Jest | 121/125 | Les 4 échecs sont des timeouts d'environnement (`act(...)`, `Exceeded timeout of 5000ms`), pas des assertions cassées — même défaut préexistant déjà noté précédemment, pas une régression. |
| Mobile `npm audit` | 15 modérées | Toutes dans la chaîne d'outils Expo CLI (dev-time : `xcode`/`uuid`, `query-string`/`decode-uri-component`), pas dans le runtime embarqué. |
| Backend `tsc --noEmit` | ✅ 0 erreur | |
| Backend Jest | **725/727** (2 échecs) | Les 2 échecs sont le 2FA staff manquant — voir section 1. Ce ne sont pas des tests instables : ils documentent un comportement de sécurité qui devrait exister et n'existe plus. |
| Backend `npm audit` | 1 modérée (`qs`) | Correctif direct disponible (`npm audit fix`). |
| Admin-web `npm run build` | ✅ corrigé (2026-09-11) | `manualChunks(id: string)` — rebuild vérifié, `dist/` généré (index 690 Ko, pdf 631 Ko, charts 418 Ko). |
| Admin-web Vitest | ✅ 180/180 | |
| Admin-web `npm audit` | ✅ 0 vulnérabilité | |

## 6. Ce qui fonctionne réellement et doit être conservé

- RBAC à permissions fines, synchronisé UI/backend dans l'ensemble (à l'exception du cas Treasury ci-dessus).
- Verrouillage de ligne SQL (`FOR UPDATE`) + garde `balance:{gte}` sur les opérations de caisse/portefeuille : protection réelle contre la concurrence, pas juste déclarative.
- Migration Float→Int : script SQL soigné (`ROUND(...::numeric)`, cohérent avec l'arrondi applicatif, taux/ratios et quantités crypto volontairement exclus), et l'incident de perte de schéma a été récupéré proprement par une méthode d'introspection sûre plutôt qu'une restauration destructive.
- JWT `HS256` explicite, `jwtVersion` pour révocation immédiate, verrouillage de compte après échecs.
- Suites de tests larges et globalement vertes (1026 tests au total sur les trois projets, hors les 4 timeouts et les 2 échecs 2FA ci-dessus).

## 8. Balayage exhaustif du 2026-09-11 (36 routes, 11 services, 30 écrans admin-web, 30 écrans mobile)

L'analyse précédente (sections 1-6) portait sur un échantillon ciblé. Ce balayage couvre tout le reste du code qui n'avait pas encore été inspecté ligne par ligne, en cherchant spécifiquement les deux mêmes classes de bug déjà identifiées (arrondi manquant avant une colonne Int, écart de permission UI/backend) plus tout nouveau problème.

### 8.1 Nouveau constat au niveau du 2FA/1 : rien à ajouter, toujours ouvert (voir section 1).

### 8.2 Doubles paiements / rejeu — les plus graves de ce balayage

- **`backend/src/routes/split.ts` (paiement de note partagée), autour de la ligne 110-157** : la vérification (`status !== 'PENDING'`) et l'écriture (`status: 'PAID'`) ne sont pas combinées dans une seule condition atomique. Deux requêtes concurrentes ou une requête rejouée pour le même split peuvent toutes les deux passer la vérification avant que l'une des deux n'écrive — la personne qui demande le remboursement peut être payée deux fois par la même personne si son solde le permet.
- **`backend/src/routes/b2b.ts`, virement de masse (`/payouts`, lignes ~214-360)** : aucune clé d'idempotence, et surtout **aucun PIN** ne protège tout un run de paie — contrairement à `/invoices/:id/pay` dans le même fichier qui, lui, exige un PIN. Un double-clic ou un retry réseau réexécute `processBulkAsync` et paie une deuxième fois chaque bénéficiaire.
- **`backend/src/routes/credit.ts`, `/apply` (ligne ~77)** : le montant de la demande de crédit n'est **strictement pas converti** (ni `parseFloat`, ni `Number()`, ni arrondi) avant d'atteindre `Loan.amount` (colonne Int) — un montant décimal fait planter la transaction avec un 500 brut au lieu d'un 400 propre.

### 8.3 Le gel automatique anti-blanchiment (SAR) ne persiste jamais — le constat le plus grave de ce balayage

`backend/src/services/LimitEngine.ts` (fonction `detectAndFreezeSAR`, ~lignes 92-109 et 167-169) : quand un compte dépasse le seuil de transactions suspectes (anti-smurfing), le code met `isActive:false` et écrit une entrée d'audit **dans la même transaction Prisma** que l'opération qui vient de déclencher l'alerte. Cette même transaction se termine ensuite par un `throw` (pour bloquer l'opération en cours) — ce qui annule (`ROLLBACK`) tout ce qui a été écrit dedans, y compris le gel du compte qu'elle venait de poser. Résultat : l'utilisateur reçoit une erreur ponctuelle sur cette transaction précise, mais son compte n'est **jamais réellement gelé** en base. Ce chemin de code est utilisé par tous les rails de paiement (`wallet.ts`, `vault.ts`, `CashOperationService.ts`). Ce n'est pas une régression récente : c'est un contrôle de conformité qui n'a probablement jamais fonctionné une seule fois depuis son écriture.

Dans le même fichier : les fenêtres de remise à zéro des plafonds jour/mois/semaine utilisent l'heure serveur locale (`new Date()`) plutôt que le fuseau horaire configuré (`Africa/Libreville`, UTC+1) déjà géré ailleurs par `backend/src/utils/timezone.ts` — les seuils réglementaires peuvent glisser jusqu'à une heure.

### 8.4 Fuite d'information — seuils anti-fraude publics

`GET /api/settings` (sans authentification, volontairement public pour les besoins du client mobile) renvoie l'intégralité de `SystemSettings` à l'exception de 4 champs masqués (clés API/secrets webhook). Cela inclut en clair : les seuils anti-fractionnement (`antiFractioningMaxAmount/MaxCount/WindowHours`), le seuil de déclenchement KYC, tous les plafonds journaliers/mensuels/par transaction par palier, et — plus sensible — **si l'allowlist IP de l'admin est activée, et la liste elle-même** (`adminIpAllowlist`, `adminIpAllowlistEnabled`). N'importe qui peut donc calibrer des transactions juste sous les seuils de détection, ou savoir si le portail admin est protégé par IP avant de tenter quoi que ce soit.

### 8.5 Écarts de permission UI/backend supplémentaires (même famille que le cas Treasury déjà connu)

Le balayage complet des 30 écrans admin-web confirme que **23/30 sont corrects** (le commit d'hier a bien réglé la majorité des cas). Mais 4 écrans ont le même défaut, non couverts par ce commit :

- **`Settings.tsx`** : aucun onglet ne vérifie `perm_system_settings_edit` (seul `perm_system_settings_approve`/`_view` gate l'onglet entier). Un COMPLIANCE_CHECKER (qui a `_approve` mais pas `_edit` par défaut) voit et peut remplir tous les formulaires de configuration (frais, trésorerie, KYC, anti-fraude, passerelles, disjoncteur) et n'est bloqué qu'au clic sur « Enregistrer ».
- **`SupportCenter.tsx`** : trois groupes d'actions non protégés — changement de statut/escalade de ticket (exige `perm_ticket_resolve` côté serveur), actions sur les cas de fraude (exige `perm_customer_flag`), ajout de note (exige `perm_support_note`/`perm_ticket_resolve`). Un TELLER ou un RISK qui accède à l'écran (via `perm_ticket_view` seul) voit tous ces boutons et se fait systématiquement rejeter en 403.
- **`BranchDashboard.tsx`** : le formulaire de demande de financement et le bouton de rapport de rapprochement ne sont protégés par aucun `hasPerm`, alors que le backend exige `perm_branch_manage` pour les deux. **Le code contient déjà un commentaire admettant explicitement le bug** (« un TELLER cliquant ici recevait un 403 silencieux ») sans que le correctif ait été appliqué.

Le motif `hasPerm ? hasPerm([...]) : true` (accès autorisé par défaut si la prop manque) reste dupliqué dans 7 fichiers — c'est ce copier-coller qui laisse systématiquement passer ce genre de cas.

### 8.6 Mobile — un vrai bug, le reste est propre

- **`src/app/(tabs)/crypto.tsx` (achat/vente crypto, lignes ~67 et ~87)** envoie le montant tapé par l'utilisateur **tel quel, en texte, sans même un `Number()`** à `/api/crypto/buy`/`/sell` — pire que les écrans déjà connus (`remit.tsx`, `services/water.tsx`) qui au moins convertissaient sans arrondir. Une virgule, un espace ou une décimale fait planter l'achat ou produit un comportement non prévu côté serveur.
- Bonne nouvelle vérifiée en détail : **le flux PIN + OTP du client mobile est intact**, sans chemin de contournement — la décision d'exiger l'OTP est entièrement pilotée par le serveur (`AuthContext.tsx`), `reset-pin.tsx` exige bien le code OTP avant tout changement de PIN, et `pin-change.tsx` force une déconnexion après changement.
- PVit (webhook de paiement externe) est **correctement sécurisé** : comparaison de secret en temps constant, montant toujours repris depuis la transaction en base (jamais depuis le payload entrant), et protection anti-rejeu par verrou atomique — aucun problème trouvé.

### 8.7 Ce qui est confirmé propre par ce balayage (pour équilibrer)

`loyalty.ts`, `pay.ts`, `tontine.ts`, `family.ts` (arrondi correct, garde-fous IDOR explicites) ; `admin.vaults/tontines/merchants/systemAccounts/search.ts` (permission systématiquement vérifiée par action, pas juste par connexion) ; `RBAC.ts` (43 permissions, pas de repli permissif sur rôle inconnu) ; `notifications.ts`/`reclamation.ts` (toutes les requêtes scopées à l'utilisateur authentifié, aucun paramètre client de confiance) ; `tontineService.ts`/`vaultService.ts` (idempotence des paiements garantie par contrainte unique en base, pas seulement par la logique applicative) ; `kycVendorCheck.ts` (stub honnête, aucune usurpation possible).

## 9. Fonctionnalités non connectées à un partenaire externe réel (audit du 2026-09-12)

Demandé explicitement par le porteur du projet : « si rien n'est connecté de l'autre côté, il ne faut pas le mettre en activité. » Classement de chaque fonctionnalité touchant potentiellement un service externe : RÉEL (connecté pour de vrai) / INTERNE ASSUMÉ (produit maison, honnêtement présenté comme tel) / FAKE-PRÉSENTÉ-COMME-RÉEL (l'interface laisse croire à un service externe réel qui n'existe pas).

| Fonctionnalité | Statut | Constat |
|---|---|---|
| **Remise internationale** | 🔴 FAKE-PRÉSENTÉ-COMME-RÉEL — **le plus grave** | `remit.ts` a un tableau de taux commenté « Mock Rates for MVP ». L'argent est débité du client puis crédité au compte interne Mongain — rien ne part jamais vers la destination. L'écran affichait pourtant « Transféré ! Fonds expédiés vers le réseau [devise]. » |
| **Cartes virtuelles** | 🔴 FAKE-PRÉSENTÉ-COMME-RÉEL | Numéro et CVV générés par `Math.random()` (`cards.ts:39-62`), aucun réseau Visa/Mastercard, aucun processeur. L'écran dit « Payez en ligne partout dans le monde » — une vraie tentative de paiement serait refusée partout. Découverte additionnelle : aucune route ne permet de dépenser ou retirer l'argent une fois chargé sur la carte (`/fund` sans contrepartie) — un piège à fonds indépendant du partenaire choisi. |
| **Crypto** | 🔴 FAKE-PRÉSENTÉ-COMME-RÉEL | Taux codé en dur, commenté « Mocked live exchange rates ... for DEMO » (`crypto.ts:14`), avec un `Math.random()` pour simuler un marché en direct. Aucune bourse, custodian ni blockchain. Contrairement aux autres fonctionnalités non connectées, celle-ci n'avait même pas de coupe-circuit avant ce correctif. |
| Recharge Airtel/Moov, factures SEEG/Canal+ | 🟠 FAKE-PRÉSENTÉ-COMME-RÉEL, déjà coupé | Déjà derrière `ENABLE_UNVERIFIED_EXTERNAL_SERVICES` (`false` par défaut). Le `.env` local a ce flag à `"true"` — à vérifier d'urgence sur Render production. |
| BNPL | 🟡 Interne, mal étiqueté | Avance payée depuis la trésorerie centrale Mongain (mouvement réel, pas de création monétaire à cet endpoint), mais affichée comme « Avance Tiers » alors que le « tiers » c'est Mongain lui-même. |
| Investissement / Staking | 🟡 Interne, mal étiqueté | Taux fixe codé en dur, fonds mouvementés depuis la trésorerie centrale. Le vocabulaire (« Coffres de Staking », « faire fructifier votre épargne ») emprunte au vocabulaire crypto/DeFi et laisse croire à un vrai placement rémunéré. |
| Crédit | 🟢 Interne, honnêtement présenté | Règles internes, taux fixe, le texte ne prétend jamais à un partenaire externe. Point séparé à surveiller : la trésorerie centrale qui finance ces crédits est elle-même alimentable par un simple mint (`perm_treasury_mint`) — une question de couverture des réserves, distincte du sujet ici. |
| KYC (vérification) | 🟢 Honnête | Stub qui ne fait rien (`kycVendorCheck.ts`), mais l'écran dit clairement « dossier en cours de validation » (humaine) — ne prétend pas à une vérification automatique. |
| Marketplace / Escrow | ⚪ Non construit | Modèles en base, aucune route ni écran — aucun risque utilisateur aujourd'hui. |
| Mobile money PVit (dépôt/retrait) | 🟢 Réel, vérifié | Vrais appels sortants vers `api.mypvit.pro`, vérification de signature en temps constant sur les webhooks entrants. |

### Correctif immédiat appliqué

Les trois cas rouges sont désormais désactivés par défaut (HTTP 501 avec message explicite), sur le modèle déjà en place pour les factures/recharge :
- `backend/.env.example` : `ENABLE_UNVERIFIED_CRYPTO`, `ENABLE_UNVERIFIED_CARDS`, `ENABLE_UNVERIFIED_REMIT` (tous `false` par défaut).
- Gardés ouverts volontairement : `/crypto/sell` (sortir d'une position déjà simulée) et `/remit/quote` (aucun mouvement de fonds).
- L'app mobile n'a nécessité aucune modification : les trois écrans affichent déjà `e.response.data.error` dans une alerte, donc le message explicite du serveur s'affiche tel quel.

### Chemin vers une vraie intégration (recherché le 2026-09-12)

Le projet est basé en zone CEMAC (XAF, fuseau `Africa/Libreville`) — ça change les options réalistes :

- **Crypto** : ne pas construire sa propre garde d'actifs. Partenaires spécifiquement africains identifiés : [Quidax](https://www.quidax.io/c/business/), [LocalRamp](https://web3connect.com/product/crypto-onoff-ramp-apis-for-african-markets-localramp), [Ivorypay](https://www.ivorypay.io/) — infra on/off-ramp fiat↔crypto, Mongain reste la couche UI + règlement FCFA, sur le modèle exact de l'intégration PVit déjà en place.
- **Cartes** : émetteurs-as-a-service pensés pour l'Afrique : [Union54](http://union54.com/) (membre Mastercard Principal, agit comme banque émettrice — mais une vague de fraude par chargeback a forcé plusieurs fintechs africaines à suspendre leurs cartes en 2022, [voir TechCrunch](https://techcrunch.com/2022/07/18/african-fintechs-halt-virtual-dollar-cards-after-union54-chargeback-fraud-surge) — à faire confirmer ce qui a changé depuis avant de signer), [Fyatu](https://fyatu.com/region/africa/), [Bridgecard](https://bridgecard.cards/). Une fois un partenaire choisi : ne jamais stocker un vrai PAN/CVV soi-même (utiliser leur API de tokenisation), sous peine d'entrer dans le périmètre PCI-DSS.
- **Remise internationale** : point réglementaire à trancher AVANT tout choix technique — la BEAC (banque centrale CEMAC) a historiquement réservé l'émission de monnaie électronique aux banques et interdit aux acteurs non-bancaires de traiter des transferts internationaux hors CEMAC. Un avocat/conseiller réglementaire local doit confirmer si Mongain peut faire ça sans partenariat bancaire ou autorisation BEAC spécifique. Une fois ce point réglé, [Onafriq (ex-MFS Africa)](https://mfsafrica.com/) est le hub d'interopérabilité mobile money le plus réaliste (320-500M de wallets connectés dans 30+ pays via une seule API). La BEAC rejoint aussi PAPSS (système panafricain de paiement), à surveiller.

Dans les trois cas, une fois un partenaire choisi et signé, l'intégration technique suit le même schéma que PVit : appel serveur-à-serveur pour l'action réelle (achat crypto / émission carte / envoi de fonds), webhook de confirmation, réconciliation du solde réel du partenaire contre le grand livre interne — c'est la partie que ce projet sait déjà faire.

## 10. Feuille de route priorisée (mise à jour)

### Immédiat

0. **(2026-11-01, priorité absolue devant tout le reste de cette liste)** Corriger la faille d'authentification inter-canal : ajouter `if (decoded.portal || decoded.till) return res.status(403)...` en tête de `authMiddleware` (`backend/src/middleware/auth.ts:84`, avant la branche `isCorp`). Un jeton portail AUDITOR permet aujourd'hui d'agir comme le géant sur la quasi-totalité des routes mobile. Voir section 13.2-A.
0bis. **(2026-11-01)** Ajouter le PIN (ou un secret propre au membre) sur `POST /merchant-portal/payouts` au-dessus du seuil de double validation, et valider/plancher `portalApprovalThreshold` (`Number.isFinite`) pour qu'il ne puisse jamais devenir `NaN`. Voir section 13.2-C.
0ter. **(2026-11-01)** Valider `webhookUrl` dans `PATCH /gateway/keys/:id` (rejeter IP privées/loopback/link-local et schémas non-https) avant tout appel sortant. Voir section 13.2-B.
0quater. **(2026-11-01)** Faire tourner `npx tsc --noEmit` + `npm test` + `npm run build` sur les 4 projets dès que Node.js est disponible sur le poste de travail — cette passe (section 13) n'a pas pu les exécuter (voir note méthodologique en tête du Verdict) et plusieurs constats (ex. `merchant-portal.test.ts:678-681`, `:775-782`) suggèrent que la suite de tests actuelle encode certains des comportements cassés comme attendus plutôt que de les détecter.
1. ~~Restaurer le flux OTP dans `backend/src/routes/corp.ts`~~ fait (section 1).
2. Vérifier manuellement si des clients réels ont déjà utilisé crypto/cartes/remise avant le correctif de la section 9 — décider d'un remboursement si oui. **Seul point de cette liste qui reste réellement à faire.**
3. ~~Corriger la persistance du gel SAR dans `LimitEngine.ts`~~ fait (section 8.3).
4. ~~Rendre `GET /api/settings` sélectif~~ fait (section 8.4).
5. ~~Corriger la race de `split.ts` et ajouter PIN + idempotence au virement de masse B2B~~ fait (section 8.2).
6. ~~Corriger `admin-web/vite.config.ts:10`~~ fait.
7. Vérifier la valeur réelle de `ENABLE_UNVERIFIED_EXTERNAL_SERVICES` **et** `ENABLE_UNVERIFIED_CRYPTO`/`ENABLE_UNVERIFIED_CARDS`/`ENABLE_UNVERIFIED_REMIT` sur l'environnement Render de production — seul point d'infrastructure externe restant, ne peut pas être vérifié depuis ce poste.
8. Ajouter une CI minimale (typecheck + tests + build) sur les trois projets — toujours absente, c'est ce qui a permis aux régressions initiales de cette analyse de passer inaperçues.

### Avant préproduction

1. ~~Ajouter une clé d'idempotence sur le reste des routes qui déplacent de l'argent~~ fait (transfert, retrait, biller, coffre, BNPL).
2. ~~Étendre le rate limiting à toutes les routes financières~~ fait.
3. ~~Compléter l'arrondi manquant~~ fait (`bnpl.ts`, `vault.ts`, `agency.ts`, `gateway.ts`, `invest.ts`, `merchant.ts`, `ussd.ts`, `credit.ts`, `crypto.ts`, `family.ts`).
4. ~~Ajouter les gardes `hasPerm` manquantes dans `Settings.tsx`, `SupportCenter.tsx`, `BranchDashboard.tsx`~~ fait. Le motif `hasPerm ? hasPerm([...]) : true` dupliqué dans d'autres écrans (hors des trois corrigés) n'a pas été retouché — reste à faire si on veut l'éliminer partout, pas seulement là où il a causé un bug confirmé.
5. ~~Corriger le fuseau horaire des fenêtres de plafond dans `LimitEngine.ts`~~ fait.
6. ~~Retourner `403` explicite en cas de CORS refusé~~ fait.
7. Choisir et signer un partenaire réel pour au moins l'une des trois fonctionnalités désactivées en section 9 avant de rouvrir son flag ; pour les cartes, construire d'abord une route de dépense/retrait (absente aujourd'hui, indépendamment de l'émetteur choisi).
8. Relabelliser BNPL (« Avance Tiers » → « Avance Mongain ») et Investissement (sortir du vocabulaire « Staking ») pour refléter qu'il s'agit de produits internes.

### Avant lancement financier

- Reprendre les points déjà identifiés précédemment : hébergement sans cold start, sauvegardes testées, revue de sécurité externe, validation juridique des services affichés (crypto, crédit, remittance, cartes) — en particulier la question BEAC/CEMAC sur la remise internationale (section 9).

## 11. Marchands Géants — portail web dédié + affiliation avec consentement (2026-09-13)

Nouveau palier de compte marchand (`User.merchantTier === 'GIANT'`, additif à `role='MERCHANT'`) pour les institutions qui reçoivent de l'argent d'un grand nombre d'autres marchands (mairie, impôts, grandes entreprises) : tableau de bord web dédié, affiliation d'autres marchands pour suivre leur régularité de versement, mobile restreint à la consultation.

**Sessions mobile + web concurrentes** — le besoin explicite d'une connexion simultanée sur les deux canaux pour un même compte a nécessité une deuxième chaîne de session complète, séparée de `jwtVersion`/`refreshTokenHash` (mobile) : `User.portalTokenVersion`/`portalRefreshTokenHash`/`portalRefreshTokenExpiresAt`, nouveau middleware `authMerchantPortal` (`backend/src/middleware/auth.ts`) vérifiant un claim JWT `portal: true`. Une connexion sur un canal n'invalide jamais l'autre, mais chaque canal reste single-session sur lui-même. Les 4 endroits qui bumpent déjà `jwtVersion` en cas de suspension/révocation admin (`admin.ts` : `/users/:id/block`, `/freeze`, `/logout-all`, `/revoke-sessions`, `/reset-pin`) bumpent désormais aussi `portalTokenVersion`.

**Affiliation avec consentement** — nouveau modèle `MerchantAffiliation` (statuts PENDING/ACCEPTED/REJECTED/REVOKED, contrainte unique par paire géant/marchand). Un géant ne peut pas suivre les versements d'un marchand sans que celui-ci l'accepte explicitement depuis son mobile (`GET/POST /api/merchant/affiliations`, nouvel écran `src/app/merchant-affiliations.tsx`) — pas de notification-seule unilatérale. Un géant ne peut pas s'affilier un autre géant.

**Garde de canal côté back-end** (pas seulement l'UI) — un marchand géant ne peut initier aucun mouvement d'argent depuis le mobile : garde `isGiantMerchant()` (`backend/src/utils/merchantTier.ts`) ajoutée sur `wallet.ts` (`/transfer`, `/client-initiated-withdraw`, `/qr-cash-out`, `/push`) et `b2b.ts` (`/payouts`). La logique métier de paiement de masse (`b2b.ts`) et de demande de retrait (`merchant.ts`) a été factorée en fonctions exportées (`runMassPayout`, `createMerchantPayoutRequest`) réutilisées telles quelles par le nouveau routeur `backend/src/routes/merchant-portal.ts` (dashboard jour/mois, rapports, affiliations côté géant, paiement employés, retrait vers agence), toutes derrière `authMerchantPortal`.

**Nouvelle appli web** `merchant-portal/` (React 19 + Vite, en miroir de `admin-web/`, stockage de session dans une clé `localStorage` distincte pour coexister avec `admin-web` dans le même navigateur) : login OTP, dashboard, rapports, affiliations, paiement employés et retrait vers agence — ces deux derniers reproduisent le mécanisme anti-double-paiement déjà établi dans `B2BHub.tsx` (clé d'idempotence stable par tentative, régénérée seulement après succès).

Revue de sécurité dédiée (agent indépendant) : aucune faille bloquante trouvée sur les gardes de canal, le flux d'affiliation ou les messages d'erreur (pas de fuite d'énumération de compte). Un seul point mineur relevé — `/users/:id/block`/`/freeze` ne bumpaient pas les versions de session (couvert de toute façon par la revérification d'`accountStatus` à chaque requête) — corrigé par cohérence avec les autres routes de révocation.

Vérifié : `cd backend && npx tsc --noEmit` propre, `npx jest --maxWorkers=2` → 813/813 ; racine (mobile) `npx tsc --noEmit` propre, `npx jest --maxWorkers=2` → 150/150 ; `merchant-portal/` : `npx tsc -b --noEmit` et `npm run build` propres. Migrations Prisma : `20260913000000_add_merchant_tier_and_portal_session`, `20260913010000_add_merchant_affiliation`.

### 11bis. Marchands Géants — 4 manques comblés (2026-09-13)

Après revue, 4 manques réels identifiés et comblés :

1. **Promotion staff → géant** : `PATCH /api/admin/users/:id/merchant-tier` (`admin.ts`, permission `perm_merchant_manage` déjà existante), garde `role==='MERCHANT'`, bump `portalTokenVersion` sur rétrogradation, écran dans `admin-web/src/Customer360.tsx` ("Promouvoir en marchand géant" / "Rétrograder").
2. **Niveaux de permission sur le portail web** : nouveau modèle `MerchantPortalMember` (rôle ADMIN/VIEWER, session indépendante — `tokenVersion`/`refreshTokenHash` propres). Un membre se connecte avec son propre téléphone via le même flux OTP que le géant ; le JWT porte toujours `userId = giant.id` (routes existantes inchangées) plus `memberId`/`role`. Nouveau middleware `requirePortalAdmin` posé sur toutes les routes d'écriture. Nouvel écran `merchant-portal/src/Team.tsx`.
3. **Conformité automatique** : `MerchantAffiliation.expectedFrequency` (MONTHLY/WEEKLY), `complianceStatus` (OK/LATE) calculé en comparant le dernier versement complété à la fenêtre attendue (`startOfMonthInTimezone`/`startOfWeekInTimezone`), affiché en badge sur le portail web et sur l'écran mobile `merchant-affiliations.tsx`.
4. **Répertoire d'employés** : modèle `MerchantEmployee`, routes côté géant (`merchant-portal.ts`) et côté marchand normal mobile (`b2b.ts`), intégré au formulaire de paie groupée du portail web.

Vérifié : backend `npx jest --maxWorkers=2` → 878/878 (813 + 65 nouveaux) ; mobile 156/156 ; admin-web (vitest) 193/193 ; `merchant-portal/` build Vite propre. Migration : `20260913020000_add_merchant_portal_team_and_employees`.

## 12. Analyse concurrentielle marchands + 4 manques comblés (2026-09-14)

Recherche web (3 agents) comparant Mongain aux concurrents mobile money africains (Wave, MTN MoMo, Orange Money, Airtel Money, M-Pesa), aux portails business internationaux (Stripe, PayPal, Square, Wise, Flutterwave) et aux plateformes de collecte fiscale/conformité. Conclusion positive sur un point : le système d'affiliation avec consentement (section 11) n'a **aucun équivalent documenté** ailleurs — différenciant, pas un manque.

4 manques confirmés et comblés :

1. **API publique marchand réparée et complétée ("Mongain Connect")** — découverte en cours de route : deux systèmes de clés API coexistaient sans jamais communiquer (`ApiKey` self-service câblé mais jamais notifié, `ApiIntegration` avec `webhookUrl`/environnement/permissions administré par le staff via `admin.ts` mais jamais utilisé pour authentifier une vraie requête). Unifié sur `ApiIntegration` : `backend/src/routes/gateway.ts` réécrit (auth par paire clé publique/secrète, self-service), livraison réelle de webhooks signés HMAC (`backend/src/utils/webhookDelivery.ts`, nouveau modèle `ApiWebhookDelivery`) déclenchée sur `POST /b2b/invoices/:id/pay` et `/reject`. Écran mobile `merchant-api-keys.tsx`.
2. **Rôles enrichis sur le portail marchand géant** — `MerchantPortalMember.role` passe de Admin/Lecture seule à 4 niveaux nommés (ADMIN/MANAGER/OPERATOR/AUDITOR, sur le modèle M-Pesa/Flutterwave), nouveau middleware `requirePortalRole(...)` paramétrable.
3. **Approbation à plusieurs + import CSV employés** — un paiement de masse au-dessus d'un seuil configurable (`User.portalApprovalThreshold`) reste `AWAITING_APPROVAL` tant qu'un second membre (jamais l'initiateur) ne l'approuve pas (modèle Wise). Import d'un répertoire d'employés par simple collage CSV (`backend/src/utils/employeeCsv.ts`).
4. **Guichets/caisses multiples** (`MerchantTill`, sur le modèle "SIM mère" d'Orange Money) — un marchand avec plusieurs points d'encaissement crée un login dédié par guichet (téléphone+PIN, sans OTP, session `authMerchantTill` strictement limitée à l'encaissement), qui crédite toujours le wallet du marchand propriétaire. Nouveau fichier `backend/src/routes/till.ts`, écrans mobile `merchant-tills.tsx`/`till-login.tsx`/`till-collect.tsx`.

Réalisé via une dizaine de vagues d'agents parallèles, régulièrement interrompues par des limites de session/coupures de process (jamais des erreurs de code) — chaque reprise a été faite avec un état exact vérifié par tsc/grep plutôt qu'une supposition, pour ne jamais dupliquer ou perdre le travail déjà fait. Un bug de contention de tests (échecs intermittents à `--maxWorkers=2` sous forte charge d'agents concurrents, disparaissant à charge normale) a été diagnostiqué et n'est pas un bug applicatif.

Vérifié à l'identique en fin de course : backend `npx tsc --noEmit` propre, `npx jest --maxWorkers=2` → 976/976 ; mobile `npx tsc --noEmit` propre, `npx jest --maxWorkers=2` → 177/177 ; `merchant-portal/` : `npx tsc -b --noEmit` et `npm run build` propres. Migrations : `20260914000000_add_gateway_webhooks_approval_tills`.

## 13. Revue exhaustive du 2026-11-01 (6 agents parallèles, ~71 000 lignes, demande explicite d'une « analyse complète ligne par ligne »)

### 13.0 Méthodologie

Découpage en 6 lots couvrant l'intégralité des quatre projets (backend routes argent + services, backend plateforme/admin/auth, admin-web, fonctionnalité marchand « GIANT » + guichets Till inter-apps, écrans mobile argent, écrans mobile compte/auth) — chaque agent a lu l'intégralité des fichiers de son lot (pas des extraits), avec consigne explicite de ne pas faire confiance aux sections précédentes de ce document sans réverifier le code actuel. Les constats A et C de la section 13.2 ont en plus été reverifiés personnellement par relecture directe des fichiers sources cités (pas seulement acceptés du rapport d'agent). **Aucune exécution de `tsc`/`jest`/`build` n'a été possible cette fois** (Node.js introuvable sur le PATH de ce poste de travail, indépendant du projet) — voir note en tête du Verdict. Plusieurs fichiers neufs, jamais committés dans git au moment de cette revue, ont reçu une attention particulière : `backend/src/routes/till.ts`, `admin.giants.ts`, `backend/src/utils/webhookDelivery.ts`, `employeeCsv.ts`, `merchant-portal/src/Developers.tsx`/`Settings.tsx`/`Tills.tsx`, `src/app/merchant-tills.tsx`/`merchant-api-keys.tsx`/`till-collect.tsx`/`till-login.tsx`.

### 13.1 Vue d'ensemble

9 constats **critiques** (dont 2 vérifiés personnellement par relecture directe), répartis sur les 4 projets — le plus grave jamais trouvé dans ce document : une faille d'authentification permet à un rôle lecture-seule du portail web d'agir comme le compte marchand géant sur la quasi-totalité de l'API mobile. S'y ajoutent une vingtaine de constats majeurs et mineurs. Le socle déjà audité (RBAC de base, verrous SQL, PIN sur les routes principales, honnêteté des fonctionnalités désactivées) reste globalement solide — voir 13.4 — mais la fonctionnalité la plus récente (marchands géants, portail web, guichets) concentre la grande majorité des nouveaux problèmes graves, cohérent avec le fait qu'elle n'avait jamais été auditée avant cette passe.

### 13.2 Constats CRITIQUES

**A. [✅ vérifié personnellement] Un jeton du portail marchand (même AUDITOR, lecture seule) s'authentifie comme le géant sur presque toute l'API mobile**

`backend/src/middleware/auth.ts:74-124` (`authMiddleware`). Ce middleware protège `wallet.ts`, `vault.ts`, `tontine.ts`, `bnpl.ts`, `crypto.ts`, `remit.ts`, `cards.ts`, `credit.ts`, `split.ts`, `biller.ts`, `services.ts`, `agency.ts`, `invest.ts`, `family.ts`, `gateway.ts`, `merchant.ts` — c'est-à-dire la quasi-totalité de l'API consommateur/marchand. Il ne contient **aucune vérification de `decoded.portal`/`decoded.till`** (contrairement à `authCorp:269` qui rejette explicitement un jeton non-`isCorp`) :

```ts
// auth.ts:82-120 — branche User, atteinte par un jeton portail faute de rejet explicite
const decoded = jwt.verify(token, JWT_SECRET, {...}) as { userId: string, jwtVersion?: number, isCorp?: boolean };
if (decoded.isCorp) { ... }                      // un jeton portail n'a pas isCorp → ignoré, continue
const userCheck = await prisma.user.findUnique({ where: { id: decoded.userId }, select: { isActive: true, jwtVersion: true } });
if (userCheck.isActive === false) return res.status(403)...;
if (decoded.jwtVersion !== undefined && decoded.jwtVersion !== userCheck.jwtVersion) {   // jwtVersion est TOUJOURS undefined sur un jeton portail
    return res.status(401)...;
}
req.userId = decoded.userId;   // = l'id du géant, par construction du jeton portail
next();
```

Or `merchant-portal.ts` émet le jeton portail avec `userId = &lt;id du géant&gt;` (y compris pour un simple membre AUDITOR connecté) et jamais de claim `jwtVersion` (il porte `portalTokenVersion`/`memberTokenVersion` à la place). Le garde `decoded.jwtVersion !== undefined` ne s'exécute donc jamais pour un tel jeton — le contrôle de révocation de session se désactive silencieusement au lieu d'échouer. Ironie confirmée dans le code lui-même : le commentaire de `merchant-portal.ts:67-70` affirme l'inverse de la réalité (« le token du portail… n'y passerait pas »). `authMerchantPortal`, lui, applique bien le contrôle symétrique dans l'autre sens (`:152`, `if (!decoded.portal) return 403`) — seul `authMiddleware` a été oublié.

**Scénario concret** : un géant invite un comptable en AUDITOR (lecture seule prévue). Le comptable récupère son propre jeton portail légitime, et le rejoue en `Authorization: Bearer` sur n'importe quelle route `authMiddleware` non protégée par un garde `isGiantMerchant()` explicite (seules 6 routes le sont, voir constat suivant) — par exemple `POST /api/gateway/keys/generate` (génère une clé API au nom du géant), ou toute route vault/tontine/crédit/crypto non liée au commerce. Un AUDITOR peut ainsi agir financièrement au nom du géant, alors que son rôle est explicitement conçu pour ne jamais écrire.

**Correctif (une ligne, voir section 10 item 0)** : rejeter `decoded.portal`/`decoded.till` en tête de `authMiddleware`.

**B. [partiellement vérifié — l'absence de validation de `webhookUrl` est confirmée par lecture directe] SSRF via le webhook marchand**

`backend/src/routes/gateway.ts:134-141` (`PATCH /keys/:id`) accepte n'importe quelle chaîne comme `webhookUrl` sans validation de schéma ni blocage des plages IP privées/loopback/link-local/metadata cloud :
```ts
if (webhookUrl !== undefined) {
    if (webhookUrl !== null && typeof webhookUrl !== 'string') return res.status(400)...;
    data.webhookUrl = webhookUrl;   // aucune autre vérification
}
```
Cette URL est ensuite appelée côté serveur (`backend/src/utils/webhookDelivery.ts`) à chaque paiement/rejet de facture marchand (`b2b.ts /invoices/:id/pay` et `/reject`). N'importe quel marchand (géant ou normal, auto-service) peut donc pointer son webhook vers une IP interne au réseau de production ou un service de métadonnées cloud (`169.254.169.254`), puis déclencher l'envoi en se payant lui-même une facture avec un compte qu'il contrôle — le serveur Mongain exécute alors lui-même la requête sortante vers la cible choisie par l'attaquant. Combiné au constat A, un simple AUDITOR peut aussi initier ce chemin via `gateway.ts`.

**Correctif** : résoudre le DNS de `webhookUrl` à l'enregistrement et rejeter tout schéma non-`https` ou toute IP privée/loopback/link-local (RFC 1918, 127.0.0.0/8, 169.254.0.0/16, ::1, fc00::/7).

**C. [✅ vérifié personnellement] Virement de masse du portail marchand géant : la chaîne PIN/seuil est cassée à trois niveaux**

`backend/src/routes/merchant-portal.ts:685-749` (`POST /payouts`), confronté à `backend/src/routes/b2b.ts:265-303` (`runMassPayout`) et au schéma `MerchantPortalMember` (aucun champ PIN).

- **Au-dessus du seuil de double validation (`portalApprovalThreshold`), aucun PIN n'est demandé** — vérifié ligne par ligne : la route extrait `{ name, entries, idempotencyKey }` de `req.body` (jamais `pin`) et crée directement le `PayoutBulk` en `AWAITING_APPROVAL` sans appeler `verifyUserPin`. `POST /payouts/:id/approve` (ligne 774) ne redemande non plus aucun PIN. C'est l'inverse de l'effet recherché : **en dessous** du seuil, `runMassPayout` exige bien un PIN (`b2b.ts:301-303`) — le chemin pensé pour être le plus contrôlé (gros montant, double validation) est en réalité le seul qui n'exige la preuve d'aucun secret applicatif. Confirmé figé par la suite de tests elle-même : `merchant-portal.test.ts:678-681` envoie délibérément la requête sans `pin` et attend un succès `202`.
- **Quand un PIN est exigé (chemin sous le seuil), il est vérifié contre le PIN mobile personnel du géant, jamais un secret propre au membre connecté** — `authMerchantPortal` pose toujours `req.userId = giant.id`, donc `verifyUserPin(user, pin)` en ligne 301 de `b2b.ts` vérifie systématiquement le PIN du géant. Un MANAGER/OPERATOR invité ne le connaît pas : soit il échoue systématiquement (et finit par verrouiller 15 minutes le **wallet mobile du géant lui-même**, `failedPinAttempts`/`lockedUntil` sur `User`), soit le géant lui communique son PIN personnel pour contourner le problème — ce qui lui donne alors accès à tout le wallet mobile (transferts, retraits), pas seulement au portail.
- **`portalApprovalThreshold` n'est pas validé à l'écriture** (`PATCH /settings`, ligne ~1140) : `Number(portalApprovalThreshold)` sur une valeur non numérique produit `NaN`, stocké tel quel en base. Au paiement suivant, `totalAmount >= NaN` vaut toujours `false` en JavaScript — la double validation est alors désactivée silencieusement pour tous les paiements futurs, quel que soit leur montant.

**Correctif** : exiger un PIN (ou un secret propre au membre, à ajouter sur `MerchantPortalMember`) sur la création ET l'approbation d'un lot au-dessus du seuil ; valider `portalApprovalThreshold` avec `Number.isFinite(parsed) && parsed >= 0` avant écriture, sinon `400`.

**D. Les rôles enrichis MANAGER/OPERATOR du portail, annoncés livrés dans ce document (section 12), sont en réalité impossibles à créer côté API**

`backend/src/routes/merchant-portal.ts:886,927` (`POST`/`PATCH /team`) ne valident que `role === 'ADMIN' || role === 'VIEWER'`, alors que `middleware/auth.ts` (`PortalRole`), la migration `20260914000000_add_gateway_webhooks_approval_tills` (renomme `VIEWER`→`AUDITOR` en base) et `merchant-portal/src/Team.tsx` sont tous construits autour de 4 rôles (ADMIN/MANAGER/OPERATOR/AUDITOR). Le frontend lui-même porte un commentaire explicite non résolu (`Team.tsx:26-29`) : *« ces routes acceptent encore uniquement 'ADMIN'|'VIEWER'… l'agent backend doit encore les faire évoluer vers les 4 rôles documentés »*. Un géant qui tente d'inviter un OPERATOR ou un MANAGER échoue systématiquement en 400. **Correctif** : étendre la validation aux 4 valeurs de `PortalRole`.

**E. Suspendre ou supprimer un compte marchand géant depuis l'admin ne coupe ni son portail web ni ses guichets**

`backend/src/routes/admin.ts:695-722` (`toggle-status`) et `:959-997` (`DELETE /users/:id`) ne modifient que `isActive` — jamais `accountStatus` ni `portalTokenVersion`. Or `authMerchantPortal` (`middleware/auth.ts:162`) et `authMerchantTill` (`:251`) ne vérifient jamais `isActive`, seulement `accountStatus`/`merchantTier`. Un SUPER_ADMIN qui « désactive » ou « supprime » un marchand géant depuis l'admin coupe bien son app mobile (`authMiddleware` revérifie `isActive` en live) mais laisse son équipe continuer d'approuver des paiements de masse et ses guichets continuer d'encaisser, indéfiniment. Les routes qui bump correctement `portalTokenVersion` (`/block`, `/freeze`, `/reset-pin`, `/revoke-sessions`) existent déjà dans le même fichier — `toggle-status`/`DELETE` ont juste été oubliées. **Correctif** : aligner ces deux routes sur le même motif (bump `accountStatus` + `portalTokenVersion`), ou supprimer `toggle-status` (code mort, jamais appelé par aucune UI, dupliqué avec `/block`+`/unblock`).

**F. admin-web : un rôle standard (COMPLIANCE_CHECKER) est automatiquement déconnecté dès son tout premier écran après connexion**

`admin-web/src/utils/apiClient.ts:17-30` traite un `403` exactement comme un `401` (purge de session + rechargement de page) dans son intercepteur d'erreur global. `Dashboard.tsx` (écran d'accueil par défaut pour ce rôle, `App.tsx:57-60`) appelle `GET /api/admin/ledger`, qui exige `perm_transaction_view` (`admin.ts:922-932`) — permission **absente** de la liste par défaut de `COMPLIANCE_CHECKER` (`RBAC.ts:151-167`, qui n'a que `perm_analytics_view`). Résultat : ce rôle est déconnecté de force à chaque connexion, dès son écran d'accueil, sans message explicite. **Correctif** : ne purger/recharger que sur 401 dans l'intercepteur ; gater l'appel `/ledger` par la permission exacte ou l'ajouter à `COMPLIANCE_CHECKER` si elle est réellement voulue.

**G. admin-web : `DevPortal.tsx` et `B2BHub.tsx` sont intégralement non fonctionnels, pour n'importe quel membre du personnel, à cause d'une confusion d'architecture**

Le token du portail staff (`isCorp: true`) porte l'id de la table `Staff`. Mais `gateway.ts`/`b2b.ts` cherchent cet id dans la table `User` (`role === 'MERCHANT'`) — deux tables aux espaces d'ID disjoints, aucune ligne `User` ne partage jamais l'id d'un `Staff`. Conséquence : **100 % des actions de ces deux écrans échouent pour 100 % des rôles**, y compris SUPER_ADMIN (`DevPortal.tsx` : « Réservé aux Marchands » ; `B2BHub.tsx` : facturation et paie groupée, même échec). Ces écrans restent pourtant accessibles depuis le menu (`perm_merchant_view`) et affichent une interface entièrement crédible. **Correctif** : retirer ces deux écrans du portail staff (la vraie self-service marchand vit désormais côté mobile, `src/app/merchant-api-keys.tsx`, section 12), ou construire de vraies routes staff-admin équivalentes qui cherchent le marchand par téléphone saisi plutôt que par `req.userId`.

**H. Aucun écran mobile n'envoie la clé d'idempotence que le backend attend pourtant sur toutes les routes argent**

`src/services/api.ts` (884 lignes, grep `idempotencyKey` → 0 résultat) alors que `wallet.ts /transfer`, `/client-initiated-withdraw`, `biller.ts /pay`, `bnpl.ts /apply`/`/repay`, `vault.ts /deposit`/`/withdraw-request`, `tontine.ts /contribute` lisent et vérifient tous ce champ côté serveur, avec des commentaires explicites sur le double-tap/retry réseau à empêcher. Les gardes `useRef` présentes dans la moitié des écrans (section 13.3) protègent seulement contre un double-tap dans le même rendu React — jamais contre un retry après un vrai timeout réseau (cold start Render documenté jusqu'à 20s), précisément le cas que l'idempotence serveur a été construite pour couvrir. **Correctif** : générer une clé stable par tentative (régénérée seulement après succès, même mécanisme déjà en place dans `B2BHub.tsx`/`merchant-portal/`) et la faire porter par `apiTransfer`, `apiClientInitiatedWithdraw`, `apiDepositVault`, `apiWithdrawRequestVault`, `apiContributeTontine`, et les appels directs de `billers.tsx`/`bnpl.tsx`.

**I. `(tabs)/crypto.tsx` envoie le montant en texte brut, sans la moindre conversion**

`src/app/(tabs)/crypto.tsx:74-106` — `amountXaf: amount` (la chaîne brute du `TextInput`), jamais passée par `Number()`/`parseFloat()`/`Math.round()`. `crypto.ts:62` côté serveur fait `Math.round(parseFloat(amountXaf))`, qui tronque silencieusement un montant mal formaté (`parseFloat("5 000") = 5`) sans erreur — un achat voulu à 5000 FCFA peut s'exécuter pour 5 FCFA sans avertissement. Aggravant : la modale de confirmation PIN n'affiche jamais le montant en cours d'autorisation (contrairement à `remit.tsx`/`airtime.tsx`/`water.tsx`). Toujours identique au constat déjà fait section 8.6 — non corrigé depuis. **Correctif** : nettoyer et arrondir avant l'appel, comme partout ailleurs dans le code (`Math.round(parseFloat(amount.replace(/\s/g,'').replace(',','.')) || 0)`), et inclure le montant dans la modale PIN.

### 13.3 Constats MAJEURS

**Backend — argent** : `wallet.ts /push` (retrait Mobile Money réel) sans rate limiting, contrairement à ses routes sœurs du même fichier. `credit.ts` (`/apply`, `/repay`) entièrement dépourvu de rate limiting alors que `bnpl.ts`, décrit comme produit quasi-identique, en a un. `cards.ts /fund` toujours sans arrondi avant écriture dans une colonne `Int` (confirmé non couvert par la vague de correctifs antérieure). `GET /merchant-portal/team` renvoie `refreshTokenHash`/`tokenVersion` à tout rôle, y compris AUDITOR (fuite interne mineure, hash non salé mais non réversible en pratique). `pay.ts`/`till.ts` (`executeQrCollection`, encaissement QR marchand et guichet) sans clé d'idempotence, contrairement à toutes les routes sœurs.

**Backend — plateforme/auth** : la gestion des clés `ApiIntegration` (`admin.ts:3108-3314`) est gardée par une liste de rôles en dur (`API_ADMIN_ROLES`) totalement hors du système RBAC — aucune permission dédiée, donc impossible à retirer d'un compte précis via la matrice de droits. `corp.ts` (2FA personnel) n'a aucun compteur de tentatives sur le code OTP (`otpAuth.ts`/`verifyOtpAttempt`, déjà construit pour `auth.ts` suite à un constat identique, jamais appliqué ici) — brute-force distribué possible sur la fenêtre de validité de 5 minutes. CORS n'autorise pas la méthode `PATCH` (`index.ts:128`) alors que plusieurs écrans admin-web l'utilisent en cross-origin, dont la promotion/rétrogradation marchand géant elle-même — risque fonctionnel direct, pas de sécurité.

**admin-web** : `Treasury.tsx` — régression confirmée du bug déjà documenté (section 8.5/4.3) : les 4 boutons de type d'opération ne sont toujours pas filtrés individuellement, un Maker avec seulement `perm_treasury_allocate` peut toujours remplir le formulaire de création monétaire (`ISSUANCE`) avant un 403 ; nouveau constat, le seuil `treasuryApprovalThreshold` au-delà duquel seul un SUPER_ADMIN littéral peut approuver n'est jamais reflété côté UI (COMPLIANCE_CHECKER voit les boutons actifs puis échoue). `GiantsOverview.tsx` : la liste des géants et le détail exigent `perm_merchant_view` côté serveur, jamais vérifié côté UI (gatée seulement par `perm_analytics_view`) — un BRANCH_MANAGER voit un tableau vide trompeur ou un bouton silencieusement inopérant. `Settings.tsx` : régression du motif fail-open (`hasPerm ? hasPerm(...) : true`) précisément sur l'onglet Checker/Approbation, alors que le fichier documente lui-même pourquoi l'éviter 586 lignes plus haut ; URL de production en dur (`mongain-backend.onrender.com`) toujours présente, déjà signalée section 4.3, jamais corrigée. `StaffAccessRights.tsx` : `perm_staff_permissions_edit` reste assignable dans la matrice mais totalement inopérante (le backend vérifie le rôle littéral `SUPER_ADMIN`, jamais cette permission). `TellerTerminal.tsx` : le bouton de recherche client (prérequis à CASH-IN comme CASH-OUT) n'est gardé par aucune permission alors que le backend exige spécifiquement `perm_cash_out`, même pour un simple dépôt.

**Fonctionnalité marchand GIANT / Till** : le jeton du portail web est stocké en `localStorage` (`merchant-portal/src/api.ts:7-9`) — régression du correctif déjà appliqué à `admin-web` (migration vers `sessionStorage` suite à un risque XSS identifié, VUL-05) ; combiné au constat A, voler ce seul token (même AUDITOR) donne un accès quasi total à l'identité du géant côté mobile. `merchant.ts POST /payouts` est la seule route « argent marchand » sans garde `isGiantMerchant()`, alors que `merchant-hub.tsx` masque déjà ce formulaire côté UI pour un compte géant — confirmant que c'est un oubli, pas un choix, et que le contrôle UI seul est trivialement contournable. `admin.giants.ts` interroge un statut `'ACTIVE'` et un champ `nextPaymentDue` qui n'existent pas sur `MerchantAffiliation` (seuls `PENDING/ACCEPTED/REJECTED/REVOKED` existent, la conformité est calculée à la volée) — le tableau de bord de supervision affichera toujours 0 affiliation active et un taux de conformité à 100 %, potentiellement une erreur Prisma runtime sur `/overview`.

**Mobile — écrans argent** : la garde anti-double-tap (`useRef` synchrone, déjà appliquée à la moitié des écrans avec des commentaires explicites sur le bug qu'elle corrige) manque sur `remit.tsx`, `bnpl.tsx`, `billers.tsx`, `services/airtime.tsx`, `services/water.tsx`, `(tabs)/pay.tsx`, `(tabs)/credit.tsx`, `(tabs)/crypto.tsx`, et partiellement sur `(tabs)/cards.tsx` (`executeFund`/`handleFreeze` non protégés alors que `handleIssueCard` du même fichier l'est). Arrondi toujours manquant sur `remit.tsx` (`/quote`), `services/airtime.tsx`, `services/water.tsx` — identique aux constats de la section 4.2/8.6, non corrigé depuis. Deux implémentations parallèles du paiement de facture SEEG (`billers.tsx`→`biller.ts` vs `services/water.tsx`→`services.ts`) toujours présentes, avec un commentaire dans `biller.ts` admettant lui-même que la route sœur avait déjà divergé une fois. **29 des 31 écrans argent audités n'ont aucun test** (seuls `withdraw.tsx`/`withdraw-form.tsx` en ont).

**Mobile — compte/auth** : `SecurityWrapper.tsx`/`profile-edit.tsx` — le bypass `SecurityFlags.bypassAppLock` (déjà documenté comme fragile) a un second défaut non détecté avant cette passe : il ne dépend que de la résolution de la promesse `launchImageLibraryAsync`, jamais d'un plafond de temps dur. Si l'Activity du sélecteur d'image part en arrière-plan avant que l'utilisateur choisisse une photo (bascule sur une autre app, appel entrant), la promesse ne se résout jamais tant que l'app reste en arrière-plan — `bypassAppLock` reste bloqué à `true` indéfiniment, désactivant le verrouillage biométrique/PIN au retour au premier plan, potentiellement après plusieurs heures. `src/services/api.ts` : 7 fonctions exportées mortes (pas seulement `apiPayBill` déjà connu) — dont `apiGetWebhookDeliveries`/`apiRetryWebhookDelivery`, jamais branchées sur `merchant-api-keys.tsx`, qui laissent un marchand sans aucun moyen de voir ou relancer un webhook en échec malgré une infrastructure backend dédiée construite pour ça (section 12).

### 13.4 Constats MINEURS (liste condensée)

`split.ts /request` : montant non arrondi avant colonne `Int`. Rate limiting absent sur `gateway.ts /charge` (clé API volée = spam de notifications sans limite) et `remit.ts /send` (impact réduit, route désactivée par défaut). `backend/src/utils/employeeCsv.ts` : pas de neutralisation des préfixes `= + - @` (injection de formule) sur le nom importé — pas d'exploitation trouvée aujourd'hui (aucun ré-export existant). `till.ts` : pas de verrou par guichet sur les échecs de PIN (seulement un rate-limit par IP) — impact atténué car un guichet volé ne peut qu'encaisser, jamais retirer. `AgencyWithdrawal.tsx` (portail) : la clé d'idempotence envoyée est purement décorative côté serveur (commentaire du fichier l'admet). `admin.ts POST /users/:id/reset-pin-request` : permission trop large (`perm_ticket_view`, large diffusion) pour un déclenchement OTP vers n'importe quel client — pas de prise de compte directe, risque de nuisance SMS. Rôle `ADMIN` legacy avec `ALL_PERMISSIONS` en dur dans `RBAC.ts`, plus assignable mais à vérifier en base si des comptes existants le portent encore. `admin-web` : plusieurs champs non-token (`admin_role`, `admin_phone`...) encore en `localStorage` ; motif `hasPerm ? hasPerm(...) : true` toujours dupliqué dans 6+ fichiers (non exploitable aujourd'hui sauf `Settings.tsx`, voir 13.3) ; mode `Users.tsx lockedRole='AGENT'` orphelin jamais retiré ; aucun `React.lazy` sur les ~34 écrans (bundle ~690 Ko). `billers.tsx`/`(tabs)/pay.tsx` (mobile) : `parseFloat` sans nettoyage espace/virgule (`"5 000"` → 5, pas 5000). Texte marketing toujours trompeur sur `(tabs)/cards.tsx` (« Payez en ligne partout dans le monde ») et libellé « Avance Tiers » sur `bnpl.tsx` — féature désactivée par flag donc impact limité tant qu'il reste à `false`.

### 13.5 Ce qui reste vérifié SAIN (confirmé par cette passe, pas juste par confiance dans les précédentes)

PIN systématiquement exigé sur les mouvements d'argent principaux (`vault.ts`, `tontine.ts`, `treasury.ts`, `agency.ts`, `b2b.ts /invoices/:id/pay`, `biller.ts`, `bnpl.ts`, `invest.ts`, la plupart des écrans mobile) ; persistance du gel SAR dans `LimitEngine.ts` toujours correcte ; `tontineService.ts`/`CashOperationService.ts`/`vaultService.ts`/`centralTreasury.ts`/`systemAccounts.ts`/`creditRisk.ts`/`pvit.ts` toujours propres (idempotence, verrous atomiques) ; webhook PVit entrant toujours correctement sécurisé ; flux PIN+OTP mobile intact de bout en bout, aucun chemin de contournement trouvé ; `kycVendorCheck.ts` toujours un stub honnête ; CORS renvoie toujours 403 explicite (hors le trou PATCH) ; allowlist IP admin toujours fail-closed ; séparation des 4 chaînes d'authentification (`authMiddleware`/`authCorp`/`authMerchantPortal`/`authMerchantTill`) correcte dans les 3 sens qui avaient été pensés (seul le 4e, celui du constat A, avait été oublié) ; consentement d'affiliation marchand toujours strictement opt-in côté serveur ; `admin.giants.ts` (promotion/rétrogradation dans `admin.ts`, hors le bug de requête de `admin.giants.ts` lui-même) correctement gardé ; photos KYC toujours systématiquement derrière `perm_customer_kyc_view` ; stockage du jeton admin-web toujours en `sessionStorage` (contrairement à celui du portail marchand, constat majeur ci-dessus) ; aucun XSS (`dangerouslySetInnerHTML`) trouvé dans admin-web ; biométrie mobile à fallback sûr, jamais un bypass de l'authentification serveur.

## Sources

1. Preuves de première main : sorties de `npm test`, `npx tsc --noEmit`, `npm run build`, `npm audit` (backend, mobile, admin-web), `git show`/`git blame` sur `corp.ts`, `vite.config.ts`, la migration `restore_wiped_schema_incident`.
2. OWASP. [JSON Web Token Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_Cheat_Sheet.html).
3. OWASP. [API4:2023 — Unrestricted Resource Consumption](https://owasp.org/API-Security/editions/2023/en/0xa4-unrestricted-resource-consumption/).
4. Prisma. [PostgreSQL database connector](https://docs.prisma.io/docs/orm/v6/overview/databases/postgresql).
5. Expo. [SDK 57 reference](https://docs.expo.dev/versions/v57.0.0/).
6. Quidax. [Business / API](https://www.quidax.io/c/business/).
7. Web3Connect. [LocalRamp — Crypto On/Off-Ramp APIs for African Markets](https://web3connect.com/product/crypto-onoff-ramp-apis-for-african-markets-localramp).
8. Ivorypay. [Crypto Payment Infrastructure Built for Africa](https://www.ivorypay.io/).
9. Union54. [Card Issuing API](http://union54.com/).
10. TechCrunch. [African fintechs halt virtual dollar cards after Union54 chargeback fraud surge](https://techcrunch.com/2022/07/18/african-fintechs-halt-virtual-dollar-cards-after-union54-chargeback-fraud-surge) (2022).
11. Fyatu. [Card Issuance for Africa](https://fyatu.com/region/africa/).
12. Bridgecard. [Card issuer for Africa](https://bridgecard.cards/).
13. MFS Africa / Onafriq. [Africa's Largest Digital Payments Gateway](https://mfsafrica.com/).
14. CSIS. [Finding the Missing Link for Fintech in Central Africa](https://features.csis.org/finding-the-missing-link-for-fintech-in-central-africa/index.html).
