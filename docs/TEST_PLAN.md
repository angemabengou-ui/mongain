# Plan de Test Manuel — Mongain

## Portée et méthode

Ce document est la checklist QA manuelle de l'application **Mongain**, plateforme d'argent mobile pour le Gabon, composée de **trois applications** :

1. **Application Mobile** (React Native / Expo) — utilisée par les clients, agents et marchands.
2. **Portail Admin** (`admin-web`, React) — utilisé par le personnel Mongain (Super Admin, Risque, Conformité, Support, Responsables d'agence, Caissiers).
3. **Backend & Intégrations** (Express/Prisma) — règles métier, webhooks, intégrations externes (PVit pour le Mobile Money).

Des tests automatisés (Jest/Vitest) existent en parallèle et couvrent la non-régression du code (fonctions unitaires, endpoints API). **Ce document ne les duplique pas.** Il se concentre sur ce qu'un testeur humain vérifie le mieux :

- La justesse visuelle et l'expérience utilisateur (UX) sur mobile et web ;
- Les **flux inter-applications** — par exemple une action effectuée dans le Portail Admin (geler un compte, approuver un KYC, activer un circuit breaker) doit se refléter correctement et dans un délai raisonnable dans l'app mobile ;
- Le comportement en conditions réelles : réseau lent/instable, appareil réel, notifications push, biométrie, permissions caméra/contacts ;
- Les cas limites métier (soldes insuffisants, codes expirés, tentatives multiples, verrouillages).

Chaque item est formulé comme une procédure concrète : **action → résultat attendu**, avec les messages d'erreur exacts du code source quand ils sont disponibles (ils sont entre guillemets « »). Cochez `- [ ]` au fur et à mesure.

**Prérequis généraux avant de commencer :**
- [ ] Avoir un compte Client (`USER`), un compte Agent (`AGENT`) et un compte Marchand (`MERCHANT`) sur l'app mobile, avec du solde sur au moins un des comptes.
- [ ] Avoir accès au Portail Admin avec au moins un compte `SUPER_ADMIN`.
- [ ] Connaître le mode DEMO de l'OTP : si `TWILIO_ACCOUNT_SID` n'est pas configuré côté backend, **tout code OTP envoyé par SMS est automatiquement `1234`** (login, inscription, reset PIN) — c'est le cas probable en environnement de test/staging. Vérifiez auprès de l'équipe backend si ce n'est pas le cas avant de tester les flux OTP.

---

## Partie 1 — Application Mobile (Client)

### 1.1 Authentification

#### 1.1.1 Connexion (`auth/login.tsx`)
- [ ] Se connecter avec un numéro au format local (ex. `77000000`) → le `+241` est ajouté automatiquement, connexion réussie si PIN correct.
- [ ] Se connecter avec le **pseudo (@alias)** au lieu du numéro → doit fonctionner (le backend cherche par `phone`, `username` ou `email`).
- [ ] Se connecter avec l'**email** → doit fonctionner de la même façon.
- [ ] Laisser un champ vide et appuyer sur « Se connecter » → message « Veuillez remplir tous les champs. », aucun appel réseau.
- [ ] Saisir un identifiant inexistant → « Numéro ou code PIN incorrect. » (statut HTTP 400, pas 401 — ne doit **pas** provoquer de déconnexion locale intempestive).
- [ ] Saisir un mauvais PIN 1 fois → « Code PIN incorrect. Tentatives restantes : 2 ».
- [ ] Saisir un mauvais PIN 3 fois de suite → « Compte bloqué suite à trop de tentatives. », puis un 4e essai (même avec le bon PIN) → « Compte sécurisé. Veuillez réessayer dans X minute(s). » (verrouillage de 15 minutes).
- [ ] Avec un identifiant et PIN corrects → redirection vers l'écran **Vérification OTP** (`requireOtp: true`), pas de connexion directe.
- [ ] Icône œil sur le champ PIN → bascule affichage/masquage du PIN.
- [ ] Lien « Code PIN oublié ? » → ouvre `forgot-pin`.
- [ ] Lien « Créer un compte » → ouvre `register`.

#### 1.1.2 Vérification OTP de connexion (`auth/verify-login-otp.tsx`)
- [ ] Code correct (`1234` en mode démo) → connexion réussie, redirection vers l'accueil, jeton émis (invalide l'ancienne session — voir single-device enforcement ci-dessous).
- [ ] Code incorrect ou expiré → « Code invalide ou expiré. » / « Code OTP expiré ou invalide. » (le champ n'accepte que 4 chiffres, bouton désactivé sinon).
- [ ] **Test cross-device / single-device enforcement** : connectez-vous sur l'app avec le Compte A sur un appareil, puis reconnectez-vous avec le même compte sur un second appareil/simulateur → vérifier que le premier appareil est déconnecté à son prochain appel API (jwtVersion incrémenté à chaque connexion réussie).

#### 1.1.3 Inscription (`auth/register.tsx`) — 2 étapes
- [ ] Étape 1 : téléphone < 8 chiffres → « Numéro de téléphone invalide. ».
- [ ] Étape 1 avec numéro déjà inscrit → « Ce numéro est déjà inscrit. » (avant même l'envoi du SMS).
- [ ] Étape 1 valide → SMS envoyé (ou code démo `1234`), passe à l'étape 2.
- [ ] Étape 2, champs incomplets → « Veuillez remplir tous les champs obligatoires. ».
- [ ] Code SMS ≠ 4 chiffres → « Le code de vérification SMS doit comporter 4 chiffres. ».
- [ ] PIN ≠ 4 chiffres ou non numérique → « Le code PIN de sécurité doit comporter exactement 4 chiffres. ».
- [ ] PIN et confirmation différents → « Les deux codes PIN de sécurité ne correspondent pas. ».
- [ ] Pseudo déjà utilisé par un autre compte → « Ce pseudo est déjà utilisé par un autre compte. ».
- [ ] Code OTP invalide/expiré à la validation finale → « Code de vérification invalide ou expiré. ».
- [ ] Inscription complète et valide → compte créé, connexion automatique, redirection accueil, **solde initial = 0 FCFA**, numéro de compte généré (préfixe `1000100001…`).
- [ ] Flèche retour à l'étape 2 → revient à l'étape 1 sans perdre le numéro déjà saisi.

#### 1.1.4 Mot de passe (PIN) oublié (`auth/forgot-pin.tsx` → `auth/reset-pin.tsx`)
- [ ] Champ téléphone vide → « Veuillez entrer votre numéro de téléphone. ».
- [ ] Numéro non reconnu → « Ce numéro n'est pas reconnu. ».
- [ ] Numéro valide → SMS envoyé, redirection vers `reset-pin` avec le numéro pré-rempli en paramètre.
- [ ] `reset-pin` avec OTP ou nouveau PIN manquant → « Veuillez remplir tous les champs. ».
- [ ] Nouveau PIN ≠ 4 chiffres → « Le nouveau code PIN doit comporter 4 chiffres. ».
- [ ] Code OTP incorrect/expiré → « Code expiré ou invalide. ».
- [ ] Réinitialisation réussie → écran de succès « Code réinitialisé ! », **le déverrouillage biométrique local est désactivé automatiquement** (l'ancien PIN mis en cache serait obsolète), retour à l'écran de connexion.
- [ ] Après reset, vérifier que l'**ancienne session (tout appareil connecté avec l'ancien PIN) est invalidée** (jwtVersion incrémenté côté serveur).

#### 1.1.5 Verrou applicatif biométrique (App Lock) — `profile.tsx` + `SecurityWrapper`
- [ ] Le verrou est **désactivé par défaut** à l'installation (opt-in) — vérifier qu'un nouvel utilisateur n'a jamais l'app verrouillée au démarrage.
- [ ] Activer le toggle « Verrou Biométrique » dans Profil → mettre l'app en arrière-plan **plus de 5 secondes** puis revenir au premier plan → écran « Application Verrouillée » s'affiche, demande Face ID/empreinte.
- [ ] Rester inactif (aucun tap à l'écran) pendant **plus de 60 secondes** avec l'app au premier plan et le verrou activé → le verrou se déclenche automatiquement.
- [ ] Revenir en arrière-plan **moins de 5 secondes** (ex. notification rapide) → ne doit **pas** verrouiller l'app.
- [ ] Sur l'écran verrouillé, échec ou annulation de la biométrie → bascule vers la saisie manuelle du PIN Mongain (« Saisissez votre code PIN Mongain pour déverrouiller l'application. »).
- [ ] PIN incorrect sur cet écran → message d'erreur affiché, pas de déverrouillage.
- [ ] Sur le Web (si testé via navigateur), le verrou ne doit **jamais** s'appliquer (fonctionnalité non supportée, message « La sécurité renforcée n'est pas supportée sur le Web. » si on tente d'activer le toggle).
- [ ] Vérifier que l'ouverture de la galerie photo (KYC dans `profile-edit`) ne déclenche **pas** le verrou par erreur pendant la sélection d'image.

---

### 1.2 Accueil (`(tabs)/index.tsx`)
- [ ] Le solde s'affiche correctement, avec l'icône œil pour le masquer/afficher (`••••••••`).
- [ ] Pull-to-refresh recharge le solde et les transactions.
- [ ] Retour sur l'onglet Accueil après une opération financière (transfert, retrait…) effectuée sur un autre écran → le solde et les 3 dernières transactions sont **automatiquement rafraîchis** (pas besoin de pull-to-refresh manuel).
- [ ] Bouton rapide « Mon QR Code (Recevoir) » → ouvre `receive-qr`.
- [ ] Les 4 actions rapides (Envoyer / Scan & Payer / Recharger / Retrait) mènent aux bons écrans.
- [ ] **Compte AGENT** : une action « Guichet » supplémentaire apparaît, ouvre le scanner en mode guichet.
- [ ] **Compte MERCHANT** : une action « Mon QR Code » apparaît (au lieu du bouton générique), et un encart « Caisse du Jour » affiche le chiffre d'affaires encaissé aujourd'hui + commission du jour + commission totale (vérifier que ces montants correspondent bien aux transactions réelles, hors les lignes `REWARD-*` qui ne doivent pas être comptées deux fois).
- [ ] Section « Services & Factures » : Électricité, Crédit Air, Abo TV, Tontine, Caisses. Si `seegEnabled` ou `tontineEnabled` est désactivé côté admin (voir Paramètres > Passerelles), l'icône correspondante est grisée et un tap affiche « Service Indisponible — Ce programme est temporairement suspendu par notre administration. » sans navigation.
- [ ] Une transaction avec statut `PENDING` (dépôt Mobile Money en cours) affiche un badge « En attente » orange dans la liste, pas comme une transaction terminée.
- [ ] Une transaction `FAILED` affiche un badge « Échoué » rouge.
- [ ] Lien « Voir tout » → ouvre l'onglet Historique.
- [ ] Tap sur une transaction → ouvre le reçu (`receipt.tsx`) avec les bonnes données.

---

### 1.3 Transferts d'argent (`transfer.tsx` → `transfer-confirm.tsx`)

#### Recherche du destinataire
- [ ] Taper un numéro (≥ 8 chiffres) → recherche automatique après 600 ms (debounce), affiche la carte destinataire (nom, numéro, badge « Compte Marchand » si applicable).
- [ ] Numéro inconnu → message d'erreur affiché dans un encart rouge, bouton « Continuer » désactivé.
- [ ] Bouton « Mes Contacts » → demande permission d'accès aux contacts ; sélectionner un contact préremplit le numéro (préfixe local retiré automatiquement).
- [ ] Bouton « Scanner QR » → ouvre le scanner QR.

#### Montant et confirmation (`transfer-confirm.tsx`)
- [ ] Montant vide ou ≤ 0 → « Veuillez entrer un montant valide. ».
- [ ] PIN absent ou ≠ 4 chiffres → « Veuillez entrer votre code PIN à 4 chiffres. ».
- [ ] Saisir un montant → l'encart de frais affiche **Montant envoyé / Frais (taux P2P actuel, ex. 1%) / Total à débiter** — le frais P2P **s'applique toujours**, y compris entre deux clients standards (vérifier avec les paramètres réels configurés dans Portail Admin > Paramètres > Frais).
- [ ] Solde insuffisant pour couvrir montant + frais → message serveur « Solde insuffisant. Vous devez avoir au moins X FCFA. », **aucune transaction créée** (vérifier dans l'Historique qu'aucune ligne n'apparaît).
- [ ] Tenter de s'envoyer de l'argent à soi-même (numéro propre) → « Vous ne pouvez pas vous envoyer de l'argent à vous-même. ».
- [ ] PIN incorrect → « Code PIN incorrect. Tentative X/3. », puis blocage après 3 essais → « Compte bloqué (3 échecs). Réessayez dans 15 minutes. ».
- [ ] Transfert réussi → écran de succès avec montant, solde restant exact (montant + frais déduits), option « Partager le reçu (PDF) » génère un PDF valide.
- [ ] Après un premier transfert réussi (biométrie pas encore activée) → popup proposant d'activer Face ID/empreinte. Refuser (« Plus tard ») → ne doit rien activer silencieusement. Accepter → prochain transfert propose le bouton Face ID.
- [ ] **Double-tap rapide** sur le bouton d'envoi → ne doit produire **qu'une seule** transaction (garde anti-double-clic côté client + atomicité serveur).
- [ ] **Paiement chez un Marchand (scan QR avec `action=pay`)** → l'écran affiche « Paiement Marchand » au lieu de « Confirmation », bouton « Payer (PIN) ».
- [ ] **Bons de caisse commune (vouchers)** : si le destinataire est un marchand et que l'utilisateur détient un bon actif, une section « Payer par Caisse Commune (Bons) » liste le(s) bon(s) disponibles. Utiliser un bon sans avoir saisi le PIN → « Entrez votre code PIN ci-dessus pour utiliser ce bon. ». Avec PIN correct → paiement instantané, bon marqué comme utilisé (vérifier qu'il disparaît de la liste et ne peut plus être réutilisé).

---

### 1.4 Reçu de transaction (`receipt.tsx`)
- [ ] Le titre s'adapte au type : « Paiement reçu » / « Paiement envoyé » / « Dépôt sur compte » (référence commençant par `DEPOSIT` ou `PULL`) / « Retrait en espèces » (référence `WITHDRAW`).
- [ ] Statut `PENDING` → badge orange « En attente », icône horloge — **ne doit jamais afficher « Effectué » pour une transaction encore en attente de confirmation webhook**.
- [ ] Statut `FAILED` → badge rouge « Échoué », icône croix.
- [ ] Statut `COMPLETED` → badge vert « Effectué ».
- [ ] Bouton « Partager le reçu » → génère et propose de partager un PDF avec les bonnes informations (montant, date, référence, tiers).

---

### 1.5 QR Code — Scanner universel (`qr.tsx`) et Générer/Recevoir (`receive-qr.tsx`)

Le scanner est un **répartiteur universel** selon qui scanne et quel rôle possède le QR scanné. Tester chaque combinaison :

- [ ] **Agent scanne un Client ou Marchand** → redirige vers `agent-action` avec `action=DEPOSIT` (dépôt espèces → crédit digital, transfert gratuit).
- [ ] **Agent scanne un autre Agent** → refusé : « Un Agent ne peut pas scanner un autre Agent au guichet. ».
- [ ] **Client scanne un QR Marchand configuré en mode « Paiement »** → ouvre `transfer-confirm` en mode paiement.
- [ ] **Client scanne un QR Marchand configuré en mode « Retrait Cash »** (toggle dans `receive-qr` côté marchand) → ouvre `client-withdraw-desk`.
- [ ] **Client scanne un QR Agent** → ouvre toujours `client-withdraw-desk` (retrait).
- [ ] **Client scanne un QR Client (P2P classique)** → ouvre `transfer-confirm` standard.
- [ ] **Intention explicite « Retrait » (`?intent=withdraw`, via le bouton Retrait de l'accueil) mais QR scanné n'appartient ni à un Agent ni à un Marchand** → refusé : « Vous ne pouvez retirer de l'argent qu'auprès d'un Agent ou d'un Marchand. ».
- [ ] QR Code d'une autre application ou corrompu → « Ce QR Code n'est pas reconnu par le réseau Mongain. » / « Le QR Code est corrompu ou illisible. » ; le scanner redevient actif après 3 secondes.
- [ ] Refus de la permission caméra → écran dédié « Caméra désactivée » avec bouton pour réautoriser.
- [ ] `receive-qr.tsx` : le QR généré encode bien `mongain://user?phone=...&role=...`, et pour un marchand, le paramètre `&action=pay` ou `&action=withdraw` change selon le toggle sélectionné, avec le taux affiché en clair (« Paiement (1%) » / « Retrait Cash (1.3%) », selon les paramètres actifs).
- [ ] Bouton « Partager mon Numéro » → ouvre le partage natif du système avec un message contenant le numéro.

---

### 1.6 Retraits

#### 1.6.1 Menu Retrait (`withdraw.tsx`)
- [ ] Trois sections : « Par Code QR » (scanner), « Par Code Secret » (génère un code), « Portefeuilles mobiles et banques » (Airtel/Moov).

#### 1.6.2 Retrait par Code Secret (guichet agence)
- [ ] Montant invalide (≤ 0 ou vide) → « Montant invalide. Veuillez entrer un montant valide supérieur à 0. ».
- [ ] Code généré : 6 chiffres, affiché en 2 groupes de 3, **expire au bout de 5 minutes** — vérifier le compte à rebours et qu'après expiration l'écran affiche « — — — » et « CODE EXPIRÉ ».
- [ ] Ce code doit ensuite être validé côté guichet (Portail Admin > Teller Terminal, « Code Secret ») pour exécuter le retrait — tester le flux croisé complet (voir section 2.3).

#### 1.6.3 Retrait vers Airtel Money / Moov Africa (`withdraw-form.tsx`, via PVit)
- [ ] Numéro < 5 caractères → « Veuillez vérifier le numéro [Provider] à créditer. ».
- [ ] Montant < 500 FCFA → « Le montant minimum de retrait est de 500 FCFA. ».
- [ ] PIN ≠ 4 chiffres → « Veuillez entrer votre code PIN Mongain à 4 chiffres. ».
- [ ] Si la passerelle PVit n'est pas configurée côté admin → erreur serveur (« Les retraits Mobile Money nécessitent une configuration PVit active. »).
- [ ] Retrait initié avec succès → écran « Retrait Effectué ! » précisant que c'est **en cours de traitement**, un SMS de confirmation opérateur est attendu — **le solde est débité immédiatement** côté Mongain, avant même la confirmation opérateur (transaction `PENDING`, type `CASH_OUT`).
- [ ] Simuler un échec opérateur (webhook PVit `FAILED`, voir section Backend 3.4) → vérifier que **le montant est recrédité automatiquement** sur le solde du client et qu'une notification « Retrait échoué » apparaît (les frais éventuels ne sont **pas** remboursés).

#### 1.6.4 Retrait chez un Agent (QR permanent) — `client-withdraw-desk.tsx`
- [ ] Montant ≤ seuil gratuit (`agencyWithdrawThreshold`, ex. 500 000 FCFA) → « Frais de retrait : GRATUIT ».
- [ ] Montant > seuil → frais affichés = uniquement sur le **dépassement** du seuil (pas sur le montant total) — vérifier le calcul exact contre les paramètres actifs.
- [ ] Solde insuffisant → « Solde insuffisant pour couvrir le retrait et les frais de X FCFA. » côté serveur, traduit côté app par « Le retrait a échoué. Solde insuffisant ? ».
- [ ] Retrait réussi → redirection vers le reçu avec référence `WITHDRAW-...`, statut `COMPLETED` immédiat (contrairement au retrait Mobile Money qui reste PENDING).

---

### 1.7 Dépôt / Recharge (`recharge.tsx` → `recharge-form.tsx`)
- [ ] Si `airtelEnabled`/`moovEnabled` est désactivé côté Paramètres Admin → l'option est grisée, tap → « Service Indisponible — Le réseau [X] est temporairement suspendu pour maintenance. ».
- [ ] Numéro < 5 caractères → erreur « Veuillez vérifier le numéro [Provider] à débiter. ».
- [ ] Montant < 500 FCFA → « Le montant minimum de dépôt est de 500 FCFA. ».
- [ ] Dépôt initié → écran « Demande Envoyée ! », avertissement d'aller valider via USSD sur le téléphone Mobile Money — **le solde Mongain n'est PAS encore crédité** à cet instant (transaction `PENDING`, type `CASH_IN`).
- [ ] Une fois le webhook PVit confirme le succès (section Backend 3.4) → le solde est crédité, notification « Dépôt reçu », et sur l'écran Historique/Accueil le statut passe de « En attente » à normal (plus de badge).
- [ ] Section « Par Dépôt en Agence » → juste informative (pas d'action), explique de communiquer son numéro à un agent physique.

---

### 1.8 Guichet Agent — Dépôt/Retrait Espèces (`agent-action.tsx`)
*(Écran ouvert uniquement quand un compte AGENT scanne un client)*
- [ ] Titre et icône adaptés : « Dépôt Espèces » (le client remet du cash, l'agent crédite son wallet digital).
- [ ] Montant ≤ 0 → « Montant invalide » ; PIN ≠ 4 chiffres → « Code PIN requis ».
- [ ] Validation → utilise le même endpoint que le transfert P2P classique, mais **gratuit** pour un agent qui dépose chez un client (aucun frais 1% prélevé sur l'agent) — vérifier que le solde de l'agent baisse exactement du montant affiché sans frais additionnels.
- [ ] Reçu généré avec référence `DEPOSIT-AGENCY-...`, correctement affiché comme « Dépôt sur compte » côté client (pas « Paiement envoyé »).
- [ ] Popup d'activation biométrique proposée après la première opération réussie (même logique que transfert classique).

---

### 1.9 Services

#### 1.9.1 Airtime, Électricité, Abonnement TV (`services/airtime.tsx`, `electricity.tsx`, `tv.tsx`)
- [ ] Ces trois écrans sont **volontairement non fonctionnels** (aucune intégration réelle Airtel/Moov, SEEG ou Canal+ côté backend) : chaque écran affiche un message « en cours de déploiement » et **ne propose aucun formulaire de paiement**.
- [ ] Vérifier qu'**aucun débit** n'est possible depuis ces écrans dans l'état actuel — c'est le comportement voulu, pas un bug. Si un formulaire de paiement apparaît un jour sur ces écrans sans que le backend soit réellement branché (flag `ENABLE_UNVERIFIED_EXTERNAL_SERVICES` désactivé), **considérer ceci comme une régression critique** (le backend débiterait le client sans jamais livrer la contrepartie).

#### 1.9.2 Tontine (`services/tontine.tsx`, `tontine-create.tsx`, `tontine-detail.tsx`)
- [ ] Liste des tontines : affiche uniquement les participations actives (statut ≠ `LEFT`).
- [ ] État vide → message d'invitation à « Lancer un club ».
- [ ] Création : nom vide ou cotisation ≤ 0 → « Donnez un nom et un montant de cotisation valide. ».
- [ ] Après création, le créateur rejoint automatiquement en position #1 de l'ordre de passage.
- [ ] Fréquence Hebdomadaire/Mensuelle sélectionnable et bien reflétée dans le détail.
- [ ] Détail du groupe : la cagnotte par cycle = cotisation × nombre de participants actifs.
- [ ] Badge « C'est votre tour » visible pour le participant dont `payoutOrder === currentCycle`.
- [ ] **Créateur uniquement** : bouton « + » pour inviter un membre par numéro → numéro non inscrit sur Mongain → « Numéro non trouvé sur Mongain. » ; membre déjà présent → « Ce membre y est déjà. ».
- [ ] **Créateur uniquement** : flèches haut/bas pour réordonner les participants → vérifier que l'ordre est bien mis à jour pour tous.
- [ ] Bouton « Quitter ce club » :
  - [ ] Si l'utilisateur n'a **pas encore** touché sa cagnotte → quitte sans frais, message « Vous avez quitté le club de tontine. Vous ne serez plus prélevé aux prochains cycles. » ; l'ordre des membres suivants se resserre automatiquement.
  - [ ] Si l'utilisateur **a déjà** touché sa cagnotte → une **dette** est calculée (cotisation × nombre de bénéficiaires restants) ; solde insuffisant pour la régler → message détaillé indiquant le montant manquant à recharger avant de pouvoir quitter ; solde suffisant → le montant dû est prélevé automatiquement et le club est quitté.
  - [ ] Créateur qui tente de quitter alors que d'autres membres actifs sont présents → « En tant que créateur, vous ne pouvez pas quitter tant que d'autres membres sont actifs dans le club. ».

#### 1.9.3 Caisses Communes / Vaults (`services/vaults.tsx`, `vault-create.tsx`, `vault-detail.tsx`)
- [ ] Liste : badge « X en attente » si des retraits `PENDING` existent sur une caisse.
- [ ] Création : nom vide → « Donnez un nom à votre caisse (ex : Caisse Mariage). ». Le champ « Approbations requises » (stepper 1–10) : le créateur devient automatiquement Président + Secrétaire + Commissaire + Trésorier.
- [ ] **Dépôt** : montant vide/≤0 ignoré silencieusement (bouton désactivé) ; membre valide → solde personnel débité, solde de la caisse crédité (vérifier via double vérification solde perso avant/après).
- [ ] **Demande de retrait (Secrétaire/Initiator uniquement)** : le bouton n'apparaît pas pour un membre sans le rôle Secrétaire. Montant > solde de la caisse → refusé côté serveur. Motif < 3 caractères → « Précisez pourquoi ce retrait est demandé... ».
  - [ ] Destination « Trésorier » : si aucun trésorier désigné → message explicatif, sélection obligatoire d'un trésorier existant.
  - [ ] Destination « Envoi direct » (numéro Mongain quelconque) : numéro invalide → « Aucun compte Mongain trouvé avec ce numéro. » ; badge « Envoi direct vers un tiers » visible sur la demande en attente pour signaler aux commissaires le risque plus élevé.
  - [ ] Destination « Bon » (voucher) : génère un bon physique/numérique utilisable plus tard par le Président.
- [ ] **Approbation (Commissaire/Validator uniquement)** : le bouton « Approuver » n'apparaît pas pour un non-commissaire. Un même commissaire ne peut approuver qu'une fois (« Vous avez déjà approuvé »). Le compteur `X/Y` approbations reflète `min(requiredApprovals, nombre réel de commissaires)`.
  - [ ] **Validateurs obligatoires** : si le Président a marqué un ou plusieurs commissaires comme « approbation obligatoire », le retrait reste bloqué **même si le seuil numérique est atteint** tant que ces personnes précises n'ont pas validé — vérifier le message « En attente de la validation obligatoire de : [Nom] ».
  - [ ] Dès que le seuil est atteint (et les validateurs obligatoires ont validé) → exécution automatique et immédiate du virement, notification au demandeur « Retrait de caisse exécuté ».
- [ ] **Gestion des rôles (Président/Admin uniquement)**, accessible dans la carte « Approbations requises » : cocher/décocher Commissaire pour un membre, et un sous-toggle « Son approbation est obligatoire » n'apparaît que si Commissaire est coché.
- [ ] **Historique** : dépôts en vert (+), retraits exécutés en normal (-), affichés séparément des demandes en attente.
- [ ] Bouton « Quitter cette caisse ».
- [ ] Sur `transfer-confirm.tsx`, vérifier que les bons actifs (vouchers) apparaissent bien quand on paie un marchand (voir section 1.3).

---

### 1.10 Historique (`(tabs)/history.tsx`)
- [ ] Filtres « Tout / Envoyé / Reçu » fonctionnent correctement.
- [ ] Badges « En attente » / « Échoué » cohérents avec les statuts réels des transactions.
- [ ] Bouton téléchargement (icône en haut à droite) → génère un PDF « Relevé Bancaire Mensuel » avec les transactions actuellement filtrées, partageable.
- [ ] Pull-to-refresh fonctionne ; retour sur l'onglet après une opération sur un autre écran → liste automatiquement rafraîchie.
- [ ] Tap sur une ligne → ouvre le reçu correspondant.

---

### 1.11 Profil (`(tabs)/profile.tsx`, `profile-edit.tsx`, `pin-change.tsx`)
- [ ] Solde affiché à jour (rafraîchi à chaque focus de l'onglet).
- [ ] QR Code d'identité personnel affiché avec le bon préfixe `mongain://user?...`.
- [ ] Barre de progression « Plafond Journalier » visible uniquement pour un compte `USER` — vérifier que le pourcentage et les montants correspondent bien aux limites réelles définies côté Paramètres Admin selon le niveau KYC.
- [ ] Si `kycLevel === 0`, un bandeau incite à « Débloquer la limite d'envoi jusqu'à 2M (KYC) » → mène à `profile-edit`.
- [ ] Toggle Verrou Biométrique (voir 1.1.5).

#### Modifier le profil (`profile-edit.tsx`)
- [ ] Nom < 2 caractères → « Le nom doit comporter au moins 2 caractères. ».
- [ ] Le numéro de téléphone est affiché en lecture seule (non modifiable), avec l'explication associée.
- [ ] **Soumission KYC** (si statut ≠ APPROVED) : sélectionner les 3 documents (CNI Recto, CNI Verso, Selfie) via la galerie → aperçu miniature affiché après sélection.
  - [ ] Soumettre avec les 3 documents → statut passe à `PENDING`, message « Dossier en cours de validation ». Vérifier côté Portail Admin (KYC / Customer 360) que le dossier apparaît bien avec les 3 images lisibles.
  - [ ] Vérifier que sélectionner une photo (accès galerie) **ne déclenche pas** le verrou biométrique par erreur pendant que l'app repasse temporairement en arrière-plan (le flag `SecurityFlags.bypassAppLock` doit couvrir ce cas).
- [ ] Bouton Enregistrer désactivé tant qu'aucun champ n'a changé.
- [ ] Sauvegarde réussie → alerte de succès, retour à l'écran précédent, données rafraîchies.

#### Changer le PIN (`pin-change.tsx`)
- [ ] Ancien PIN incorrect → « Ancien code PIN incorrect » (statut 400).
- [ ] Nouveau PIN ≠ 4 chiffres → erreur de validation.
- [ ] Les deux nouveaux PIN ne correspondent pas → « Les nouveaux codes PIN ne correspondent pas. ».
- [ ] Changement réussi → **le PIN biométrique mis en cache localement est invalidé automatiquement** ; au prochain transfert, l'option Face ID ne doit plus apparaître tant qu'elle n'est pas réactivée manuellement.

---

### 1.12 Notifications (`notifications.tsx`)
- [ ] Liste triée du plus récent au plus ancien, avec icône/couleur selon le type (`TRANSACTION`, `SECURITY`, `SYSTEM`).
- [ ] Notification non lue → fond légèrement teinté + point coloré + texte en gras.
- [ ] Tap sur une notification non lue → marquée comme lue individuellement.
- [ ] Bouton « Tout lire » (visible seulement s'il existe des non-lues) → marque tout comme lu en un appel.
- [ ] Vérifier qu'une notification est bien créée pour : transfert envoyé/reçu, retrait effectué/échoué, dépôt reçu/échoué, invitation à une tontine/caisse commune, ajout à une caisse commune, retrait de caisse en attente/exécuté.

---

### 1.13 Support (`support.tsx`)
- [ ] Titre ou description vide → « Veuillez remplir tous les champs. ».
- [ ] Soumission réussie → confirmation « Notre équipe technique a reçu votre réclamation… », retour à l'écran précédent.
- [ ] Vérifier côté Portail Admin (Support & Réclamations) que le ticket apparaît bien avec le bon titre/description et le bon expéditeur.

---

## Partie 2 — Portail Admin (`admin-web`)

### 2.1 Connexion et rôles

#### Connexion (`Login.tsx`)
- [ ] Identifiants invalides → « Identifiants invalides » (générique, ne révèle pas si l'email existe).
- [ ] Compte inactif/suspendu → même message générique « Identifiants invalides ou compte suspendu ».
- [ ] Compte avec statut `PENDING` (onboarding non terminé) → « Accès refusé. Votre recrutement est "EN ATTENTE" de validation par la Direction (Maker-Checker). ».
- [ ] 5 échecs de mot de passe → verrouillage 15 minutes, « Compte verrouillé suite à trop de tentatives. Réessayez dans 15 minutes. ».
- [ ] Connexion avec un rôle non autorisé sur ce portail (ex. `MERCHANT`, qui n'a pas de compte Staff) → « Accès refusé. Expulsé par le portail Corporate. » (rôles autorisés : `SUPER_ADMIN`, `RISK`, `COMPLIANCE_CHECKER`, `SUPPORT_MAKER`, `BRANCH_MANAGER`, `TELLER`).
- [ ] Connexion réussie avec `mustChangePassword = true` (premier accès après création) → redirection **forcée** vers l'écran Changement de mot de passe, aucun autre écran accessible avant.

#### Changement de mot de passe forcé (`ChangePassword.tsx`)
- [ ] Nouveau mot de passe < 8 caractères → « Le nouveau mot de passe doit contenir au moins 8 caractères. ».
- [ ] Confirmation différente → « La confirmation ne correspond pas au nouveau mot de passe. ».
- [ ] Changement réussi → toutes les sessions précédentes sont invalidées (jwtVersion incrémenté), l'utilisateur est déconnecté et invité à se reconnecter avec le nouveau mot de passe.

#### Visibilité de la navigation selon le rôle (`App.tsx`)
Vérifier la matrice de visibilité pour chaque rôle en se connectant successivement avec chacun :
- [ ] **`SUPER_ADMIN` / `ADMIN` / `RISK` / `COMPLIANCE_CHECKER`** : accès complet — Tableau de Bord, Analytique Globale, Base Clients, Grand Livre, Trésorerie, KYC/AML, Caisses Communes, Support & Réclamations, Organisation Interne (Créer Utilisateur / Affecter Agence / Droits d'Accès / Centre des Agences / Agents legacy), Paramètres Système, Centre d'Audit, Erreurs Système.
- [ ] **`SUPPORT_MAKER`** : uniquement Support & Réclamations, Base Clients (C-360), Caisses Communes — **aucun** accès au reste (vérifier qu'un accès direct par URL/état ne contourne pas la restriction).
- [ ] **`TELLER`** : uniquement Opérations Guichet (Teller Terminal) — pas de Tableau de Bord Agence.
- [ ] **`BRANCH_MANAGER`** : Tableau de Bord Agence **et** Opérations Guichet.
- [ ] Déconnexion → efface bien le token (`sessionStorage`) et les préférences (`localStorage`), retour à l'écran de connexion.
- [ ] Rafraîchir la page (F5) → reste sur le même onglet actif au lieu de revenir au Tableau de Bord (préférence persistée en `localStorage`).
- [ ] Simuler une session révoquée côté serveur (ex. après un changement de mot de passe ailleurs) → l'appel `/api/corp/me` renvoie 401/403/404 → déconnexion automatique.

---

### 2.2 Tableau de Bord Global & Analytique (`Dashboard.tsx`, `MacroStats.tsx`)
- [ ] KPIs affichés : Chiffre d'affaires brut (taxes 1%), Volume P2P transféré, Réseau (clients/agents/marchands) — vérifier la cohérence avec les données réelles du Grand Livre.
- [ ] Graphique « Évolution des Revenus (7 derniers jours) » : seules les transactions de référence `FEE*` et statut `COMPLETED` sont comptées comme revenu.
- [ ] Erreur réseau → message d'erreur clair au lieu d'un écran blanc.
- [ ] `MacroStats.tsx` : vérifier les 6 KPI (CA, Volume, Taux de succès, Clients, Agents, Marchands), le delta jour vs veille (flèche verte/rouge), et les graphiques de tendance sur 14 jours (revenus/volume, statut des opérations, répartition par type, volume par catégorie).
- [ ] **Rôles backend `GET /api/admin/stats`** : seuls `SUPER_ADMIN`, `RISK`, `COMPLIANCE_CHECKER` sont autorisés — un `BRANCH_MANAGER` ou `TELLER` qui parviendrait à accéder à cet onglet (ne devrait normalement pas être visible dans leur navigation) doit recevoir un 403 « Accès refusé. ».

---

### 2.3 Agence — Guichet (`BranchDashboard.tsx`, `TellerTerminal.tsx`)

#### Session de caisse
- [ ] Ouvrir une session avec un montant initial → session `OPEN` créée, un caissier **ne peut avoir qu'une seule session ouverte à la fois** (« Vous avez déjà une session de caisse ouverte. » si tentative d'en ouvrir une deuxième).
- [ ] Effectuer des Cash-In/Cash-Out pendant la session → les totaux « Entrées » / « Sorties » se mettent à jour en temps réel dans le résumé du shift.
- [ ] Clôturer la session en déclarant un montant physique compté :
  - [ ] Montant compté = attendu (`initial + cashIn - cashOut`) → « rapprochement parfait », écart = 0.
  - [ ] Montant compté ≠ attendu → écart calculé et affiché (excédent/déficit), une justification peut être saisie (sinon `ECART NON JUSTIFIÉ` enregistré automatiquement).

#### Opérations Cash-In / Cash-Out (`TellerTerminal.tsx`)
- [ ] Sans session ouverte → écran forcé d'ouverture de caisse, aucune opération possible.
- [ ] Rechercher un client par téléphone → identité affichée (nom, téléphone, rôle) ; client introuvable → « Client introuvable ».
- [ ] Ne pas cliquer sur la loupe et directement « Continuer » → le client est identifié automatiquement avant de passer à la confirmation.
- [ ] Étape de confirmation récapitule bien Type / Client / Montant avant validation finale — vérifier qu'un montant erroné peut être corrigé via « Retour ».
- [ ] Cash-Out avec des frais applicables (au-delà du seuil agence) → le montant des frais est affiché sur l'écran de succès.
- [ ] **Retrait par Code Secret** : code < 6 chiffres → « Le code doit contenir 6 chiffres. » ; code expiré/introuvable → « Code expiré ou introuvable. Demandez au client d'en générer un nouveau. » ; code incorrect → « Code incorrect. » ; code correct → exécution immédiate du montant **porté par le code** (pas de ressaisie du montant), et le code est **invalidé après usage** (rejouer le même code doit échouer).
- [ ] **Test croisé mobile ↔ admin** : générer un code secret côté app mobile (`withdraw.tsx`), le saisir côté Teller Terminal avant expiration (5 min) → retrait exécuté ; après expiration → refusé.
- [ ] Fin d'opération → bouton « Nouvelle Transaction » réinitialise proprement le formulaire.

#### Demande de financement & Réconciliation (`BranchDashboard.tsx`)
- [ ] Un `BRANCH_MANAGER` peut soumettre une demande de financement (montant + motif obligatoire) → apparaît dans « Dernières Allocations » avec statut « En attente ».
- [ ] Un `TELLER` qui tente de générer le rapport de réconciliation → refusé silencieusement transformé en alerte claire (« Réservé au Manager côté serveur » — vérifier que le message d'erreur backend s'affiche, pas un échec muet).

---

### 2.4 Réseau d'Agences (`AgencyCenter.tsx`)
- [ ] Créer une agence : champs Nom et Code obligatoires (« Nom et code requis. ») ; Code déjà utilisé → « Code agence "[code]" déjà utilisé. » (409).
- [ ] Marquer une agence comme « Siège » (`isHQ`) — vérifier qu'**une seule** agence Siège doit exister (tester la création d'une deuxième, ou observer le comportement Trésorerie qui suppose un Siège unique).
- [ ] Changer le statut d'une agence (Active/Suspendue) → confirmation demandée, reflété immédiatement dans la liste et la vue 360 ; passer une agence à `ACTIVE` doit horodater sa date d'activation.
- [ ] **Immutabilité du code agence** : tenter de modifier le code d'une agence qui a **déjà au moins une transaction historique** → doit être refusé (« Code agence immuable : X transaction(s) historiques sont référencées... ») — tester sur une agence neuve (code modifiable) puis sur une agence ayant déjà traité un Cash-In/Cash-Out (code verrouillé).
- [ ] Vue 360 d'une agence — onglets : Aperçu (KPIs du jour), Personnel (assigner/désassigner du staff non affecté), Caissiers (sessions actives en temps réel), Coffre (solde physique + électronique + 10 dernières opérations), Opérations (filtrable par type/date/référence), Rapprochement (variance jour, `varianceStatus: OK` si écart < 1 FCFA sinon `DISCREPANCY`), Alertes.
- [ ] **Alertes automatiques** à vérifier une par une : `SUSPENDED` (agence suspendue, sévérité critique), `LOW_LIQUIDITY` (solde électronique ≤ 10% du seuil de retrait agence — sévérité critique si solde ≤ 0, sinon élevée), `CASH_DISCREPANCY` (sessions clôturées avec écart non nul), `STALE_SESSION` (une session restée ouverte plus de 12h).
- [ ] Désassigner un membre du staff → confirmation demandée, retire bien l'agence de son profil. **Cas bloquant à tester** : tenter de désaffecter un caissier qui a **une session de caisse actuellement ouverte** → doit être refusé (« Ce caissier a une session ouverte. Clôturer la session avant désaffectation. »).
- [ ] Assigner un staff disponible (liste des non-affectés, uniquement rôles `TELLER`/`BRANCH_MANAGER` actifs sans agence) → apparaît immédiatement dans « Staff assigné ».
- [ ] **Injection de liquidité HQ → Agence** (si testée séparément de la Trésorerie) : bloquée si le Circuit Breaker est actif (« Le Circuit Breaker est activé. Opérations financières bloquées. ») ; montant non positif → « Montant invalide. » ; tenter d'alimenter le Siège avec lui-même → « Impossible d'alimenter la Caisse Centrale avec elle-même. » ; fonds HQ insuffisants → refusé avec le solde HQ affiché.

---

### 2.5 Organisation Interne — Personnel (`StaffCreate.tsx`, `StaffAssignBranch.tsx`, `StaffAccessRights.tsx`)

Parcours d'onboarding en **3 étapes obligatoires et distinctes** :

#### Étape 1 — Créer un Utilisateur
- [ ] Tous les champs identité/contact/documentation sont requis ; mot de passe provisoire ≥ 6 caractères.
- [ ] Création → compte au rôle temporaire `TELLER`, statut « En attente », **sans agence**.
- [ ] Confirmation affichée avec instruction claire d'aller à l'étape 2.

#### Étape 2 — Affecter à une Agence
- [ ] Recherche par nom/email/matricule, filtres (Tous/Non affectés/Affectés), tri, pagination.
- [ ] Sélectionner une agence dans le menu déroulant puis « Affecter » → confirmation avant sauvegarde (« Affecter [Nom] à [Agence] ? »).
- [ ] Réaffectation d'un utilisateur déjà affecté → message de confirmation différent (« Transférer [Nom] de [Ancienne] vers [Nouvelle] ? »).
- [ ] Retirer l'affectation (sélectionner « — Non affecté — ») → confirmation « Retirer [Nom] de son agence actuelle ? ».
- [ ] Cette page ne modifie **jamais** le rôle ni le statut actif du compte (uniquement `branchId`).

#### Étape 3 — Droits d'Accès & Activation
- [ ] File d'attente : uniquement les comptes déjà affectés à une agence (étape 2 complète) et au statut `PENDING`.
- [ ] Sélectionner un rôle (Teller/Responsable d'Agence/Conformité/Analyste Risque/Support Client/Super Administrateur) puis « Activer » → confirmation explicite du rôle et de l'agence, puis le compte devient `ACTIVE` avec ce rôle **immédiatement**.
- [ ] Section « Reconfigurer un compte existant » : recherche uniquement parmi les comptes `ACTIVE`/`SUSPENDED` (pas les `PENDING`, déjà couverts par la file ci-dessus).
- [ ] Changer le rôle d'un compte actif → bouton « Enregistrer » apparaît seulement si une modification a été faite.
- [ ] Suspendre un compte actif → confirmation (« Il/elle perdra immédiatement l'accès. ») ; **tester immédiatement une connexion avec ce compte** → doit être bloquée après suspension (le backend incrémente `jwtVersion`, ce qui révoque aussi tout token déjà émis — si le compte était connecté ailleurs, son prochain appel API doit échouer).
- [ ] Réactiver un compte suspendu → confirmation, accès restauré.
- [ ] **Rôles autorisés côté backend pour créer/approuver du personnel** : uniquement `SUPER_ADMIN` et `RISK` (`POST /api/admin/staff` et `PUT /api/admin/staff/:id/approve`) — un `COMPLIANCE_CHECKER` connecté ne devrait **pas** pouvoir onboarder de nouveau personnel malgré son accès large ailleurs ; message attendu « Seule la direction peut habiliter du personnel. » / « Autorisation Maker-Checker requise pour valider un recrutement. ».
- [ ] **Anti-auto-approbation stricte sur le recrutement** : un compte qui a lui-même **créé** une fiche « En attente » ne peut pas l'activer lui-même (sauf `SUPER_ADMIN`, seule exception) → « Le recruteur ne peut pas approuver le compte qu'il a lui-même créé. ». Tester avec 2 comptes `RISK` distincts : le créateur ne doit pas voir/pouvoir activer sa propre création, un second agent `RISK` doit le pouvoir.
- [ ] Email professionnel déjà utilisé lors de la création (Étape 1) → « Cet email professionnel est déjà attribué. ».

---

### 2.6 Base Clients & Marchands / Customer 360 (`Users.tsx`, `Customer360.tsx`)

#### Liste (`Users.tsx`)
- [ ] Segments Clients / Marchands / Tous ; recherche par nom/téléphone/ID/référence transaction ; filtres Statut et Niveau KYC.
- [ ] Accès refusé (403, rôle non habilité pour ce segment) → message d'erreur explicite affiché, **pas** une liste vide silencieuse.
- [ ] Créer un compte Marchand (SUPER_ADMIN uniquement) : téléphone, nom, PIN (4 chiffres) requis → création réussie → bascule automatiquement sur le segment « Marchands » pour que le nouveau compte soit visible immédiatement.
- [ ] Vue « Agents Mongain (ancien système) » (`lockedRole=AGENT`, menu Organisation Interne) : colonne supplémentaire « Agence » avec sélecteur inline pour rattacher un agent legacy à une agence — vérifier que le changement est bien appliqué sans recharger toute la page.
- [ ] Tap sur une ligne → ouvre la fiche Customer 360.

#### Fiche Customer 360 — Onglets

- [ ] **Test de redaction par rôle** : ouvrir la même fiche client avec un compte `SUPER_ADMIN`/`RISK`/`COMPLIANCE_CHECKER`/`SUPPORT_MAKER` (accès complet) puis avec un compte `BRANCH_MANAGER` ou `TELLER` (accès élargi en lecture, `GET /api/admin/users/:id/360` reste accessible mais les champs sensibles — email, photos d'identité, plafonds personnalisés, solde — doivent apparaître **masqués/vides**, pas seulement visuellement grisés côté front).

**Aperçu**
- [ ] KPIs : Statut Compte, Niveau KYC, Rôle, Solde (masqué `••••• FCFA` pour les rôles non habilités), Flags de risque actifs, Réclamations.
- [ ] Le solde n'est visible que pour `SUPER_ADMIN`, `RISK`, `COMPLIANCE_CHECKER`, `SUPPORT_MAKER` (`isSensitive`).

**KYC**
- [ ] Documents (CNI Recto/Verso, Selfie) visibles uniquement pour les rôles habilités.
- [ ] Approuver → dossier passe à `APPROVED`, le client voit son plafond augmenter immédiatement côté mobile (tester le flux croisé : approuver ici, puis vérifier `profile.tsx` côté mobile — la barre de plafond journalier doit refléter le nouveau tier).
- [ ] Rejeter sans motif → « Motif de rejet requis. » ; avec motif → dossier `REJECTED`, le client voit le statut « rejeté » côté mobile lors de sa prochaine soumission.

**Wallet**
- [ ] Lecture seule stricte — bandeau rappelant que le solde ne peut **jamais** être modifié directement depuis cet écran (toute correction doit passer par un remboursement tracé ou une opération de trésorerie).

**Limites**
- [ ] Affiche les limites effectives (globale COBAC = plafond réglementaire fixe **10 000 000 FCFA**, KYC par tier — 0 = Standard, 1 = Vérifié, 2 = Premium —, override custom actif le cas échéant).
- [ ] **Demande de modification (Maker/Checker)**, ouverte à `SUPER_ADMIN`/`RISK`/`COMPLIANCE_CHECKER`/`SUPPORT_MAKER` : type de limite + nouveau plafond + motif requis (« Montant et raison requis. ») → soumis pour approbation par un Checker (ne s'applique pas immédiatement). Demande dépassant **10 000 000 FCFA** → refusée (« Dépassement du plafond réglementaire COBAC (10M FCFA). »). Une **deuxième** demande du même agent pour le même client alors qu'une première est encore en attente → refusée (« Une demande est déjà en attente pour ce client. ») — mais **un autre agent** (auteur différent) peut, lui, en soumettre une nouvelle en parallèle : à signaler comme incohérence potentielle si observé en test.
- [ ] **Plafond VIP (SUPER_ADMIN uniquement)** : confirmation explicite « Cette action s'applique instantanément, sans passer par un Checker » → appliqué **immédiatement**, sans aucune approbation, contrairement à la « Demande de modification » ci-dessus qui, elle, passe toujours par un Checker. Plafond hors bornes (< 100 ou incohérent) → « Plafond invalide. ». Vérifier que la limite change réellement côté mobile sans délai.

**Transactions**
- [ ] Filtres type/statut fonctionnels.
- [ ] Bouton « Rembourser » visible uniquement sur les transactions `COMPLETED`, pour les rôles sensibles.
- [ ] Demande de remboursement : montant max = montant original (vérifier qu'un montant supérieur est rejeté, « Le montant doit être positif. » si ≤ 0) ; motif requis ; la transaction doit réellement appartenir à ce client (sinon 403 « Cette transaction n'appartient pas à ce client. ») ; une **deuxième** demande sur la même transaction déjà en cours (`REQUESTED`/`UNDER_REVIEW`/`APPROVED`) → refusée (« Une demande de remboursement est déjà en cours pour cette transaction. ») ; soumission valide → statut « en attente Checker », **la transaction originale n'est jamais modifiée** (un nouveau mouvement comptable est créé séparément à l'approbation, référence `REFUND-...`).

**Cash Ops**
- [ ] Encart Anti-Fractionnement : si `flagged = true`, alerte rouge visible avec le détail (retraits 24h/7j, nombre d'opérations, agences utilisées, montant moyen). Le déclenchement se produit précisément quand **3 retraits ou plus en 24h** OU **2 agences différentes utilisées en 24h** — tester en simulant exactement ce scénario pour un même client (2 puis 3 retraits rapprochés) et vérifier que le flag bascule à `true` seulement à partir du 3ᵉ, pas avant.

**Sécurité**
- [ ] Affiche tentatives PIN échouées, verrouillage, version JWT (sessions actives), motif de blocage.
- [ ] Action « Déverrouiller PIN » — motif ≥ 3 caractères requis.
- [ ] Action « Révoquer toutes les sessions » (rôles Risk uniquement) — motif requis ; **tester le flux croisé** : révoquer, puis vérifier que l'app mobile du client est bien déconnectée à son prochain appel.
- [ ] Action « Déclencher Reset PIN » (rôles Risk uniquement) — motif ≥ 5 caractères.

**Risque**
- [ ] Créer un flag (type + description requis) → apparaît immédiatement dans la liste des flags actifs et sur le badge « Risque » de la liste Clients.
- [ ] **Geler le compte (FROZEN)** : motif structuré obligatoire ; si « Autre », commentaire ≥ 10 caractères requis. Une fois gelé → **tester côté mobile** que le compte ne peut plus effectuer d'opérations financières (transfert, retrait).
- [ ] **Dégeler** : justification ≥ 10 caractères requise → compte repasse `ACTIVE`.
- [ ] **Suspendre (SUSPENDED)** : motif ≥ 5 caractères ; **Réactiver** : motif ≥ 5 caractères.

**Réclamations**
- [ ] Fusion lecture + action : créer un ticket, changer son statut (OPEN → IN_PROGRESS → RESOLVED → CLOSED), ajouter une note interne.
- [ ] Une note marquée « [CLIENT] » (non interne) doit être distinguable visuellement des notes internes.

**Actions Admin / Audit**
- [ ] Timeline chronologique complète des actions effectuées sur ce compte, avec auteur et détail — vérifier qu'une action effectuée plus haut (gel, KYC, limite VIP, etc.) apparaît bien ici immédiatement après.

---

### 2.7 KYC / AML (`KycMod.tsx`)
*(Vue simplifiée alternative à l'onglet KYC de Customer 360, accessible directement depuis le menu Risque & Conformité)*
- [ ] Onglet « Dossiers en attente » vs « Identités Certifiées ».
- [ ] Rejeter sans motif (ou motif < 3 caractères) → bloqué côté client avant même l'appel réseau (« Motif de rejet requis (minimum 3 caractères). »).
- [ ] Approuver/Rejeter → confirmation demandée avant envoi, puis rafraîchissement automatique de la liste.
- [ ] Les 3 documents (CNI Recto/Verso, Selfie) doivent être visibles en pleine résolution suffisante pour vérification manuelle — signaler si une image manquante affiche bien « Manquant » au lieu d'un cadre vide silencieux.

---

### 2.8 Grand Livre / Ledger (`Ledger.tsx`)
- [ ] Recherche par numéro, référence ou nom fonctionne sur l'ensemble des transactions chargées.
- [ ] Étiquettes visuelles : `[FEE]` (frais), `[MINT]` (création monétaire), `[CASH-IN]` (dépôt agence/PVit) — vérifier la cohérence avec les préfixes de référence réels (`FEE-`, `MINT-`, `DEPOSIT`/`CIN`/`PULL`).
- [ ] Accès refusé (403) → message d'erreur explicite, pas un registre vide silencieux.
- [ ] Export CSV → fichier téléchargé avec les colonnes attendues et uniquement les lignes actuellement filtrées par la recherche.
- [ ] Export PDF → généré à la demande (chargement différé du module, vérifier l'absence de ralentissement au chargement initial de la page), contenu conforme au filtre actif.
- [ ] Bouton « Rembourser » : absent sur les lignes `FEE`, `MINT`, `CASH-IN` et sur toute transaction non `COMPLETED` — présent uniquement sur les mouvements P2P/retraits standards complétés.
- [ ] Demande de remboursement sans motif → bloquée côté client (`window.prompt` annulé = pas de soumission) ; avec motif → confirmation puis soumission au flux Maker/Checker (apparaît ensuite dans Support > Remboursements).

---

### 2.9 Trésorerie (`Treasury.tsx`)

#### Vue d'ensemble
- [ ] KPIs : Masse Monétaire Totale, Réserve Centrale, Portefeuilles Clients, Liquidité Agences (E-Wallet), Liquidité Physique (Coffre) — le panneau « Rapprochement Comptable » doit toujours afficher un écart de 0 FCFA (masse monétaire = Réserve + E-Wallets agences + Wallets clients, par construction).

#### Liquidité des Agences
- [ ] Statuts `HEALTHY`/`LOW`/`CRITICAL` cohérents avec les seuils configurés dans Paramètres > Trésorerie & Liquidité.

#### Rapprochements
- [ ] Résoudre un cas → résolution (texte) obligatoire, sinon la demande n'est pas soumise (`window.prompt` vide/annulé).

#### Registre des Mouvements — Maker/Checker
- [ ] **Créer une requête** (onglet « Lancer Opération ») :
  - [ ] Type `ISSUANCE` (Mint) : aucune agence cible nécessaire, crédite directement la Réserve Centrale ; plafonné à `maxMintAmount` (Paramètres > Trésorerie) — dépasser ce plafond → refusé côté backend.
  - [ ] Type `ALLOCATION` (vers Agence) : agence cible obligatoire ; le Siège lui-même ne peut **jamais** être ciblé (« Le Siège est la Réserve Centrale elle-même : impossible de le cibler... ») ; fonds centraux insuffisants → refusé.
  - [ ] Type `RETURN` (depuis Agence) : agence source obligatoire ; un `BRANCH_MANAGER` ne peut initier un retour que pour **sa propre** agence (« Vous ne pouvez initier un retour que pour votre propre agence. »).
  - [ ] Type `ADJUSTMENT` / `REVERSAL` : agence optionnelle (laissable vide pour cibler la Réserve elle-même).
  - [ ] Motif toujours obligatoire ; confirmation explicite avant soumission.
- [ ] **Approuver (Checker)** :
  - [ ] Un Maker **ne peut pas approuver sa propre requête** (sauf `SUPER_ADMIN`, seule exception) → « Principe de sûreté enfreint : Un Maker ne peut pas s'approuver. ».
  - [ ] Requête déjà traitée → « Cette demande a déjà été traitée (Statut: X). » (idempotence — tester en approuvant deux fois rapidement/en double-clic, un seul mouvement de fonds ne doit avoir lieu).
  - [ ] Montant au-dessus du seuil (`treasuryApprovalThreshold`) → seul un `SUPER_ADMIN` peut approuver (un `COMPLIANCE_CHECKER` doit être refusé sur ces montants).
  - [ ] Circuit Breaker actif → toute approbation refusée (« Circuit Breaker actif, opération interdite. »).
  - [ ] Approbation réussie → **tester le flux croisé** : allouer des fonds à une agence, puis vérifier immédiatement côté `BranchDashboard`/`TellerTerminal` que le solde E-Wallet de l'agence a bien augmenté du montant exact.
- [ ] **Rejeter (Checker)** : motif obligatoire (≥ 5 caractères côté backend), requête marquée `REJECTED` définitivement (immuable, ne peut plus être réapprouvée).

---

### 2.10 Caisses Communes — Vue Admin (`Vaults.tsx`)
*(Lecture seule, pour comprendre un litige avant d'y répondre — aucune action de modification)*
- [ ] Liste : Caisse, Président, Membres, Solde, Seuil, badge « X en attente » si des retraits `PENDING` existent.
- [ ] Détail : membres avec leurs rôles (badges Président/Secrétaire/Commissaire/Trésorier), historique des transactions (avec approbations `X/seuil`), bons de retrait émis (actif/utilisé) — vérifier la cohérence exacte avec ce qui est visible côté mobile pour la même caisse.
- [ ] Confirmer qu'**aucun bouton d'action** (approuver, forcer un retrait, changer un rôle) n'existe sur cette vue — c'est volontaire.

---

### 2.11 Support & Réclamations (`SupportCenter.tsx`)

#### Tableau de Bord
- [ ] KPIs : Ouverts, En Cours, Attente Client, SLA Dépassés, Critiques, Remboursements en attente, Fraudes actives.

#### Boîte de Réception (tickets)
- [ ] Filtres statut/priorité/catégorie/recherche/SLA dépassé combinables.
- [ ] Ouvrir un ticket → panneau détail avec métadonnées (client, assigné, transaction liée, agence liée, SLA, escalade).
- [ ] Boutons de transition rapide de statut (`IN_PROGRESS`, `WAITING_CUSTOMER`, `WAITING_INTERNAL`, `RESOLVED`, `CLOSED`) et bouton dédié « ESCALADE ».
- [ ] Ajouter une note : cocher/décocher « Note Interne » — une note **non interne** est explicitement badgée « RÉPONSE CLIENT » (vérifier qu'elle serait visible par le client, contrairement à une note interne).
- [ ] **Test croisé** : soumettre un ticket depuis `support.tsx` côté mobile → vérifier qu'il apparaît bien ici avec le bon client, titre et description.

#### Fraudes
- [ ] Cycle de statut : `OPEN` → `INVESTIGATION` → `CONFIRMED`/`FALSE_POSITIVE` → `CLOSED`. Vérifier que les boutons d'action affichés changent bien selon le statut courant (pas de bouton « Confirmer » sur un dossier déjà `OPEN`, par exemple).

#### Remboursements
- [ ] Rôles `FINANCE_ROLES` (`SUPER_ADMIN`, `RISK`) uniquement peuvent Approuver/Rejeter/Exécuter — un autre rôle habilité au Support (ex. `SUPPORT_MAKER`) voit un message « En attente d'approbation Finance » / « En attente d'exécution Finance » à la place des boutons d'action.
- [ ] Approuver → statut `APPROVED`, bouton « ⚡ Exécuter » apparaît.
- [ ] Exécuter → statut `EXECUTED` ; **vérifier le flux croisé complet** : le solde du client concerné doit être recrédité côté mobile, et une notification doit apparaître dans son onglet Notifications.
- [ ] Rejeter → motif conservé et affiché (`rejectionReason`), statut `REJECTED` définitif.

---

### 2.12 Paramètres de la Plateforme (`Settings.tsx`)

Processus **strict Maker → Checker** pour toute modification (sauf mention contraire) : chaque section a un bouton « Déposer Changement (Maker) » qui **ne s'applique jamais immédiatement**, une raison est demandée à la soumission (`window.prompt` si non pré-remplie), puis la modification apparaît dans l'onglet « Approbation (Checker) ».

- [ ] **Général** : nom plateforme, monnaie, contacts support.
- [ ] **Politique de Frais** : Retrait Agence (seuil gratuit + taux marginal sur dépassement), Retrait Marchand (taux fixe, sans seuil), Dépôt & P2P — utiliser le **Simulateur de Frais** intégré pour vérifier que le calcul affiché correspond exactement à ce qui est réellement appliqué côté mobile pour chaque type d'opération (comparer avec les tests de la Partie 1 et 3).
- [ ] **Trésorerie & Liquidité** : plafond de création monétaire (Mint), seuil d'approbation Super Admin, seuils d'alerte liquidité agences (Low/Critical).
- [ ] **Plafonds & KYC** : limites journalières/par transaction par Tier (0, 1…) — tester qu'une modification approuvée change bien immédiatement les limites affichées côté mobile (`profile.tsx`) pour un client de ce tier.
- [ ] **Anti-Fractionnement** : fenêtre de cumul (heures), seuil d'alerte, nombre max d'opérations, action automatique (Observer/Appliquer frais/Bloquer).
- [ ] **Intégrations (API)** : générer une clé pour un marchand → le secret (`sk_...`) n'est affiché **qu'une seule fois** à la génération, jamais récupérable ensuite (vérifier qu'il n'apparaît dans aucune liste après fermeture du panneau). Rotation d'une clé → invalide l'ancien secret immédiatement (confirmation explicite demandée). Activer/désactiver une intégration.
- [ ] **Passerelles de Paiement** :
  - [ ] Toggles Airtel/Moov (indépendants des identifiants PVit) → **tester le flux croisé** : désactiver Airtel ici, vérifier que `recharge.tsx` côté mobile grise bien l'option Airtel avec le message « Service Indisponible ».
  - [ ] Configuration PVit (clé secrète, code URL paiement, compte d'opération, code callback, clé webhook) : les champs secrets affichent un placeholder masqué (`••••XXXX`) et non la vraie valeur ; **laisser un champ secret vide et sauvegarder ne doit jamais écraser le secret existant en base** (vérifier ce cas précisément — c'est un piège UX corrigé intentionnellement).
  - [ ] Bouton « Générer » pour la clé de webhook → génère une valeur aléatoire côté client, affiche l'URL complète à enregistrer sur le tableau de bord PVit.
  - [ ] Bandeau de statut : « Configuré » seulement si les 4 champs PVit sont renseignés, sinon « Incomplet — le dépôt Mobile Money reste désactivé ».
- [ ] **Circuit Breaker** : bouton unique, gros et rouge — déclencher (Maker) puis faire approuver (Checker) → **tester immédiatement côté mobile qu'un transfert P2P est bien bloqué** pendant que le breaker est actif ; le désactiver ensuite et re-tester qu'un transfert redevient possible.
- [ ] **Approbation (Checker)** : liste des demandes `PENDING` avec Maker/Action/Motif ; Valider → « impactera immédiatement le système » (confirmation explicite) ; Rejeter → confirmation également.
- [ ] **Historique** : chaque changement appliqué liste Date/Paramètre/Ancienne→Nouvelle valeur/Auteur/Validé par/Motif. **Les valeurs des clés secrètes (API keys, secrets PVit) doivent apparaître masquées ici aussi** (`••••XXXX`), jamais en clair, même dans l'historique.

---

### 2.13 Audit & Erreurs Système (`AuditLogs.tsx`, `ErrorLogs.tsx`)

#### Centre d'Audit
- [ ] Liste chronologique de toutes les actions administratives sensibles (Horodatage/Administrateur/Action/Détails).
- [ ] Accès refusé (403) → message clair, pas un journal vide silencieux.
- [ ] Vérifier qu'une action effectuée n'importe où dans ce document (gel de compte, approbation de trésorerie, changement de paramètre, activation de staff…) génère bien une ligne correspondante ici.

#### Erreurs Système
*(Distinct des réclamations client — ce sont les échecs techniques backend : intégrations externes, exceptions non gérées)*
- [ ] Filtres Source et Résolu/Non résolu/Toutes.
- [ ] Cliquer sur une ligne → déplie les détails techniques (route concernée, JSON formaté si présent).
- [ ] Marquer comme résolue → disparaît de la vue « Non résolues » par défaut ; si c'était la dernière erreur de la page courante, la pagination se recale automatiquement sur une page valide au lieu d'afficher une page vide.
- [ ] Provoquer une erreur réelle en environnement de test (ex. couper temporairement la config PVit et tenter un dépôt Mobile Money) → vérifier qu'elle apparaît bien ici peu après.

---

## Partie 3 — Backend & Intégrations (vérifications transverses)

Ces points sont mieux vérifiés en observant le comportement réel de l'API (via les apps ci-dessus ou un client HTTP) plutôt qu'en lisant le code — ils recoupent des règles déjà mentionnées en Partie 1/2 mais méritent une vérification dédiée car ce sont des points de rupture classiques.

### 3.1 Authentification
- [ ] **Mode démo OTP** : si `TWILIO_ACCOUNT_SID` n'est pas configuré, tout code envoyé (inscription, login, reset PIN) est `1234` — confirmer avec l'équipe backend quel mode est actif avant de rapporter un « bug » de code non reçu par SMS.
- [ ] **Rate limiting SMS** : 5 requêtes OTP par IP / 15 min (limite globale Express), **et** 3 requêtes par **numéro de téléphone** / heure (anti-fraude spécifique) → au-delà, « Trop de demandes pour ce numéro. Veuillez réessayer dans 1 heure. » ou message IP équivalent.
- [ ] **Verrouillage compte client** : 3 échecs de PIN consécutifs → verrouillage 15 minutes (login, transfert, retrait, dépense de bon — tous les chemins de vérification PIN partagent la même logique de compteur `failedPinAttempts`).
- [ ] **Verrouillage compte staff (admin)** : 5 échecs de mot de passe consécutifs → verrouillage 15 minutes.
- [ ] Un identifiant de connexion peut être **numéro, pseudo ou email** indifféremment côté mobile ; côté admin uniquement l'email.

### 3.2 Wallet & Transferts — règles de frais à vérifier avec les valeurs réelles configurées
- [ ] **P2P (`/wallet/transfer`)** : frais = `montant × taxP2P`, sauf si l'expéditeur a le rôle `AGENT` (0% — dépôt guichet gratuit). **Aucune autre exemption** (ni ADMIN, ni MERCHANT) n'existe côté serveur — vérifier qu'aucun rôle non documenté n'échappe aux frais.
- [ ] **Retrait chez un Marchand (`/wallet/client-initiated-withdraw`, rôle MERCHANT)** : frais = `montant × taxWithdraw` (taux fixe, sans seuil gratuit) ; une partie (`rewardMerchant`) revient au marchand en commission, le reste au compte Corporate.
- [ ] **Retrait chez un Agent (même endpoint, rôle AGENT)** : gratuit jusqu'au seuil `agencyWithdrawThreshold`, puis `agencyTaxWithdraw` appliqué **uniquement sur le dépassement** du seuil (pas sur le montant total).
- [ ] **Retrait Mobile Money (`/wallet/push`)** : frais = `montant × taxWithdraw`, solde débité immédiatement (transaction `PENDING` jusqu'à confirmation PVit).
- [ ] **Dépôt Mobile Money (`/wallet/pull`)** : montant minimum 500 FCFA, crédité uniquement à la confirmation webhook (jamais à l'initiation).
- [ ] **Anti-blanchiment / Plafonds** (`LimitEngine`) : s'applique de façon **unifiée** sur tous les rails sortants (transfert P2P, retrait QR agent/marchand, retrait guichet, paiement de facture) — vérifier qu'un client Tier 0 ne peut pas contourner sa limite journalière en changeant simplement de méthode (ex. transférer juste sous la limite P2P, puis immédiatement retirer via QR agent pour dépasser le plafond réel).
- [ ] **Routes désactivées par défaut** (flags d'environnement `ENABLE_UNVERIFIED_CARD_TOPUP` / `ENABLE_UNVERIFIED_EXTERNAL_SERVICES`) : `/wallet/topup` (carte bancaire), `/wallet/pay-service`, `/services/pay-bill`, `/services/topup` (crédit téléphonique) → doivent renvoyer une erreur 501 explicite tant que le flag n'est pas activé et qu'aucune vraie intégration PSP/opérateur n'est branchée. **Ne jamais activer ces flags en production sans intégration réelle** — un appel authentifié suffirait sinon à débiter un client sans contrepartie livrée.

### 3.3 Webhooks PVit (`/api/webhooks/pvit-status`)
- [ ] Protégé par une **clé partagée en paramètre d'URL** (`?key=...`), comparée à `pvitWebhookSecret` — un appel sans la bonne clé → 403 « Clé de webhook invalide. ».
- [ ] Référence transaction inconnue ou déjà traitée (non `PENDING`) → accusé de réception renvoyé quand même (**jamais** d'erreur, pour éviter que PVit ne considère l'intégration comme cassée et ne bloque le compte sandbox), mais **aucune double écriture** ne doit avoir lieu.
- [ ] Statut `SUCCESS` sur un `CASH_IN` → wallet destinataire crédité, notification « Dépôt reçu ».
- [ ] Statut `SUCCESS` sur un `CASH_OUT` → déjà débité en amont, simple notification de confirmation « Retrait réussi ».
- [ ] Statut échec sur un `CASH_IN` → transaction `FAILED`, notification « Dépôt échoué », **aucun crédit**.
- [ ] Statut échec sur un `CASH_OUT` → transaction `FAILED`, **le montant est recrédité automatiquement** au client, notification « Retrait échoué… recrédité sur votre solde. » — **les frais déjà prélevés ne sont pas remboursés** (comportement volontaire, à signaler si jugé à revoir côté produit).

### 3.4 Cohérence inter-applications à vérifier systématiquement

Ces scénarios recoupent des points déjà couverts individuellement en Partie 1 et 2, mais méritent d'être testés **de bout en bout dans une seule session** pour capturer les problèmes de synchronisation, de latence ou de cache :

- [ ] Admin gèle un compte (Customer 360 > Risque) → le client ne peut plus transférer ni retirer côté mobile presque immédiatement.
- [ ] Admin approuve un KYC → le plafond journalier affiché côté mobile (Profil) augmente sans redémarrage de l'app (au prochain focus de l'écran).
- [ ] Admin approuve une allocation de Trésorerie vers une agence → le solde E-Wallet de cette agence augmente côté Teller Terminal/BranchDashboard.
- [ ] Admin exécute un remboursement → le solde du client augmente côté mobile et une notification apparaît.
- [ ] Admin active le Circuit Breaker → toute opération financière mobile est bloquée jusqu'à désactivation.
- [ ] Admin désactive un canal (Airtel/Moov/SEEG/Tontine) dans Paramètres > Passerelles → l'écran mobile correspondant se grise et refuse l'action au prochain chargement des réglages.
- [ ] Client génère un code de retrait secret côté mobile → agent le valide côté Teller Terminal avant expiration → solde débité correctement des deux côtés, transaction visible de manière cohérente dans l'Historique mobile **et** le Grand Livre admin.
- [ ] Client soumet un ticket support → apparaît dans la Boîte de Réception admin avec les bonnes métadonnées ; une réponse non-interne ajoutée côté admin devrait (à vérifier selon la roadmap) être visible côté client.
