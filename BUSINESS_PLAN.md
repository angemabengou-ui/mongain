# PLAN D'AFFAIRES (BUSINESS PLAN) : MONGAIN
**"L'OS de la finance communautaire, marchande et familiale en Afrique Centrale"**

---

## 1. RÉSUMÉ EXÉCUTIF

Mongain est une Super-App Fintech (Mobile Money, Core Banking & Services Financiers) conçue pour le marché d'Afrique centrale, avec le Gabon comme marché pilote. Contrairement aux solutions de paiement classiques qui se limitent au transfert P2P, Mongain s'est construit comme un véritable système d'exploitation financier : un portefeuille grand public ultra-social (Caisses Communes, Tontines, Comptes Enfant), une gamme complète de produits financiers (cartes virtuelles, crypto-actifs, épargne rémunérée, micro-crédit), et un ERP institutionnel (logiciel de caisse gratuit, portail agents/marchands, back-office RBAC) qui transforme chaque boutiquier en agence physique de notre réseau.

Ce n'est plus un concept sur papier : le socle technique complet (backend, application mobile, portail d'administration) est **déjà construit et opérationnel**, couvrant la quasi-totalité des cas d'usage financiers d'un foyer et d'un commerçant africains. Ce document décrit ce produit réel, son modèle économique et sa trajectoire de mise à l'échelle.

## 2. LE PROBLÈME ET L'OPPORTUNITÉ

L'économie d'Afrique centrale repose sur plusieurs piliers que les opérateurs télécoms (Airtel, Moov) et les agrégateurs numériques ignorent ou sous-exploitent :

1. **La finance communautaire est archaïque.** Tontines, cotisations de deuil, cagnottes familiales, épargne de groupe... Ces flux brassent des milliards de FCFA de manière totalement opaque (cahiers manuscrits, argent liquide caché, risque de perte ou de détournement, aucune traçabilité en cas de litige).
2. **Le boutiquier et l'agent mobile money sont sous-équipés.** Les kiosques mobile money utilisent des codes USSD lents et archaïques, sans le moindre outil moderne de gestion de caisse, de comptabilité ou de suivi de leur stock de liquidités (float).
3. **L'accès aux services financiers avancés reste un privilège urbain et bancarisé.** Crédit instantané, épargne rémunérée, cartes de paiement en ligne, transferts internationaux : ces produits existent, mais restent hors de portée de l'immense majorité des utilisateurs de mobile money, faute d'infrastructure adaptée à leur profil de risque.
4. **Aucun produit ne pense la famille comme une unité financière.** Les parents n'ont aujourd'hui aucun moyen numérique, sûr et supervisé, d'initier leurs enfants à la gestion de l'argent — ils passent par du liquide, sans traçabilité ni contrôle.

## 3. LA SOLUTION : LA PROPOSITION DE VALEUR MONGAIN

Mongain aborde le marché avec une plateforme unique dont chaque brique renforce les autres (effet d'écosystème), créant de fortes barrières à l'entrée (*moat*) qu'un concurrent mono-produit ne peut répliquer isolément.

### Pour les particuliers (Application Mobile B2C)

* **Compte courant digital complet** : portefeuille FCFA, virements P2P instantanés, retraits/dépôts via agents et QR marchand, historique et notifications en temps réel.
* **Caisses Communes & Tontines Numériques** : portefeuilles partagés où chaque membre voit le solde en temps réel ; prélèvements automatiques, quorum d'approbation configurable, bons de retrait, relevés exportables.
* **Comptes Enfant (Supervision Parentale)** — *différenciateur unique sur le marché* : un parent crée un compte à part entière pour son enfant (son propre numéro, son propre code PIN), définit un plafond de dépense journalier ou hebdomadaire, recharge son solde sans frais, et reçoit une notification en temps réel à chaque dépense ainsi qu'un historique complet. C'est le seul produit de la zone qui pense l'éducation financière et la sécurité des mineurs comme une fonctionnalité native, pas un contournement.
* **Cartes Virtuelles** : émission gratuite, rechargeables depuis le portefeuille, pour les paiements en ligne — élargit l'usage de Mongain au-delà de l'écosystème mobile money vers le e-commerce.
* **Épargne rémunérée (Coffres de Staking)** : blocage volontaire de fonds sur une durée choisie contre un taux d'intérêt garanti, sans passer par une banque traditionnelle.
* **Micro-crédit instantané & BNPL** : avance de trésorerie basée sur un score de confiance comportemental (fréquence d'usage, historique de transactions), remboursable en une ou plusieurs échéances.
* **Investissement crypto-actifs** : achat/vente d'actifs numériques directement depuis le solde FCFA, avec les mêmes garde-fous AML/KYC que le reste de la plateforme.
* **Transferts internationaux** : corridor de remise de fonds avec conversion de devises, sur le même rail de sécurité que les opérations locales.
* **Partage de factures, points de fidélité, paiement de factures (SEEG/Canal+) et rechargement crédit téléphonique** : les usages du quotidien centralisés dans une seule application.
* **Accès USSD** : les opérations essentielles (transfert P2P) restent accessibles depuis un téléphone non-connecté, sans exclure la clientèle sans smartphone.
* **Sécurité de niveau bancaire** : verrouillage biométrique (FaceID/empreinte), détection algorithmique de fraude (moteur anti-smurfing/structuration), plafonds progressifs par palier KYC.

### Pour les marchands et agents (Application + Portail Web B2B/ERP)

* **Logiciel de caisse gratuit** : terminal de vente et de gestion de caisse complet (sessions de caisse, rapprochement X/Z de fin de journée). En l'adoptant pour leur commerce quotidien, les boutiquiers deviennent *de facto* des points de retrait/dépôt (cash-in/cash-out) pour le réseau Mongain.
* **Réseau d'agences et d'agents** : gestion de succursales, tellers, float de trésorerie, injection de liquidités depuis le siège.
* **Facturation B2B** : émission et règlement de factures entre professionnels directement dans l'écosystème Mongain.
* **Comptabilité et reporting en temps réel**, avec une matrice de droits d'accès (RBAC) ultra-granulaire pour gérer plusieurs caissiers ou plusieurs agences — une sophistication rarement vue chez un acteur de cette taille sur le marché.

### Pour l'institution elle-même (Back-Office Corporate)

Un portail d'administration complet (conformité KYC, gestion des réclamations, détection de fraude, gel de comptes, trésorerie centrale, pilotage des paramètres système) — l'infrastructure de contrôle qu'attendent les régulateurs (COBAC/CEMAC) et les partenaires bancaires, déjà opérationnelle et non un simple engagement sur plan.

## 4. MODÈLE ÉCONOMIQUE (Revenus)

La rentabilité de Mongain repose sur une diversification de revenus rare pour un acteur de cette maturité :

1. **Frais transactionnels (Pay-as-you-go).** Modèle transparent : **1 %** prélevé sur les transactions externes (retraits via agent, paiements marchands, transferts). Les mouvements internes au foyer (recharge d'un Compte Enfant par son parent) sont volontairement gratuits — un choix de confiance qui renforce l'adoption familiale plutôt que la monétisation immédiate.
2. **SaaS Freemium (B2B).** Le logiciel de caisse est gratuit pour un marchand seul ; un abonnement mensuel s'active dès qu'il souhaite plusieurs accès caissiers paramétrables ou la gestion de plusieurs agences.
3. **Monétisation du float.** Les fonds bloqués dans les Tontines, les Caisses Communes et les Coffres de Staking restent captifs dans l'écosystème Mongain nettement plus longtemps que sur un portefeuille mobile money classique. Cette trésorerie flottante, replacée en banque centrale, génère un revenu financier significatif et récurrent.
4. **Marge sur les produits de crédit.** Intérêts sur le micro-crédit et le BNPL, calculés sur un scoring comportemental propriétaire — un revenu à marge élevée, adossé à des données que seule une super-app peut collecter.
5. **Marge de change sur les transferts internationaux** appliquée au taux de conversion des corridors de remise de fonds.
6. **Frais d'émission/gestion sur les services optionnels** : cartes virtuelles premium, plafonds personnalisés, produits d'investissement.

## 5. STRATÉGIE D'ACQUISITION (GO-TO-MARKET) & AVANTAGE CONCURRENTIEL

**Face à la concurrence (Airtel Money, Moov Money, solutions de paiement classiques) :**

Les concurrents dépensent des fortunes en publicité pour recruter client par client (CAC élevé). Mongain casse ce modèle grâce à des **boucles de viralité structurelles**, intégrées au produit lui-même plutôt qu'ajoutées en marketing :

* **Viralité par la Caisse Commune/Tontine** : un chef de famille qui ouvre une caisse pour un mariage (50 invités) contraint mécaniquement ces 50 personnes à télécharger l'application pour y verser leur participation en toute transparence — acquisition client gratuite, en grappe, avec une intention de paiement immédiate.
* **Viralité par le Compte Enfant** : chaque compte parent peut générer plusieurs comptes enfant réels et actifs (pas de simples profils) au sein du même foyer — un multiplicateur d'utilisateurs actifs unique sur ce marché, et un ancrage émotionnel fort (la sécurité de ses enfants) qui réduit drastiquement le churn du compte parent.
* **Onboarding marchand à friction quasi nulle** : au lieu de recruter des "agents", Mongain offre un logiciel de caisse gratuit et immédiatement utile pour leur activité quotidienne. La fonction d'agent Mongain n'est qu'un bonus à haute valeur ajoutée, pas la promesse de vente initiale.
* **Profondeur produit comme barrière à la sortie** : un utilisateur qui a son épargne dans un Coffre, sa Tontine active, le compte de son enfant et sa carte virtuelle chez Mongain a un coût de migration bien plus élevé que chez un simple portefeuille P2P.

## 6. INFRASTRUCTURE DE CONFORMITÉ — UN ATOUT, PAS UNE CONTRAINTE

Contrairement à une startup qui construit sa conformité après coup sous la pression d'un régulateur, Mongain a bâti dès le socle :

* Un moteur de plafonds hiérarchisés par palier KYC (0/1/2), avec plafonds journaliers, mensuels et par transaction, et un plafond réglementaire absolu non contournable.
* Une détection algorithmique de vélocité anormale (signature de smurfing/structuration), avec gel automatique et traçabilité complète (journal d'audit).
* Un contrôle de sécurité biométrique et un verrouillage progressif anti-brute-force sur chaque code PIN.
* Une matrice de droits (RBAC) granulaire côté personnel, avec circuits d'approbation à double contrôle (*maker/checker*) sur les opérations sensibles.

C'est un argument de vente direct auprès des banques partenaires et des régulateurs CEMAC/COBAC : Mongain n'est pas seulement une expérience utilisateur agréable, c'est une infrastructure bancaire déjà pensée pour l'agrément.

**Point de vigilance à trancher avant la mise à l'échelle du Compte Enfant** : aucun cadre légal ne définit aujourd'hui la capacité d'un mineur à détenir un compte e-money en son nom propre dans la zone CEMAC — un sujet à clarifier avec le régulateur et/ou un conseil juridique avant toute communication publique sur cette fonctionnalité.

## 7. ROADMAP & FEUILLE DE ROUTE OPÉRATIONNELLE

* **Phase 1 — Socle produit (réalisée).** Core Banking, Tontines/Caisses Communes, RBAC agences, cartes virtuelles, épargne rémunérée, micro-crédit/BNPL, crypto, remises internationales, facturation B2B, accès USSD, back-office de conformité complet, et Comptes Enfant avec supervision parentale. Le produit couvre déjà la quasi-totalité des usages financiers d'un foyer et d'un commerce.
* **Phase 2 — Acquisition marchands.** Déploiement des terminaux de caisse chez un premier réseau de marchands et supérettes clés au Gabon, constituant le réseau physique de cash-in/cash-out.
* **Phase 3 — Lancement social B2C.** Campagnes organiques ciblant les groupes familiaux, associations, mutuelles communautaires et écoles (Comptes Enfant) pour amorcer la viralité des Caisses Communes et des comptes familiaux.
* **Phase 4 — Extension régionale.** Réplication du modèle vers d'autres marchés CEMAC, une fois la conformité réglementaire et la traction gabonaise validées.

## 8. CONCLUSION POUR L'INVESTISSEUR

Mongain n'est pas un système de paiement de plus : c'est une plateforme financière complète — déjà construite, testée et fonctionnelle — qui fusionne l'ingéniosité de l'épargne rotative communautaire (Tontine), la robustesse institutionnelle d'un back-office de conformité, et une innovation sociale sans équivalent régional (le Compte Enfant supervisé). Elle s'attaque au problème fondamental de l'Afrique Centrale : la distribution du cash, la confiance communautaire, et l'éducation financière du foyer dans son ensemble.

Financer Mongain, c'est financer l'infrastructure digitale des dix prochaines années d'échanges intra-africains — pas un pari sur un prototype, mais l'accélération d'un produit déjà en état de marche.
