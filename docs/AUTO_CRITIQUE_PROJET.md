# Auto-critique du projet Mongain (mise à jour vérifiée)

*Analyse exécutée avec les outils du poste de travail : typecheck, suites de tests, `npm audit`, lecture directe du code, `git blame`/`git show`, et huit revues ciblées au total (deux passes : sécurité/argent générale, puis un balayage exhaustif fichier-par-fichier de tout le backend, tout l'admin-web et tout le mobile). Contrairement à une lecture des messages de commit, chaque constat ci-dessous a été vérifié dans le code ou l'exécution réelle.*

## Verdict

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
