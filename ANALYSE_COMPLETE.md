# ANALYSE COMPLÈTE DE L'APPLICATION MONGAIN (Architecture & Fonctionnalités)

## 1. ARCHITECTURE TECHNOLOGIQUE GLOBALE
Mongain (V5) repose sur une architecture moderne, découplée ("headless") et fortement typée, séparant strictement la logique métier (Backend) des interfaces (Mobile / Web).

*   **Backend (Le Cœur / Core Banking) :**
    *   **Base de Données :** PostgreSQL hébergé sur Neon. Relationnelle, robuste (ACID), idéale pour des opérations financières.
    *   **ORM (Object-Relational Mapping) :** Prisma. Assure un typage strict entre la base de données et le code, évitant les erreurs de manipulation de données.
    *   **Serveur API :** Node.js avec Express.js. Architecture RESTful.
    *   **Temps Réel :** Socket.IO intégré. Indispensable pour les Webhooks (réception des paiements externes comme Click Pay ou PVit en temps réel).
*   **Frontend B2C (Application Mobile Client) :**
    *   Développé en **React Native (Expo)**. Compilation croisée iOS / Android.
    *   Intègre des fonctionnalités natives : AppLock (biométrie FaceID/Fingerprint) pour la sécurisation de l'application en arrière-plan.
*   **Frontend B2B (Portail d'Administration / ERP) :**
    *   Développé en **React.js (Vite)**.
    *   Système de navigation dynamique (App.tsx) couplé et asservi au moteur RBAC du Backend.

## 2. CARTOGRAPHIE FONCTIONNELLE (Les Modules Clés)
L'application ne se contente pas d'être un wallet, elle reproduit le fonctionnement d'une véritable banque centrale et de son réseau.

1.  **Le Moteur Transactionnel (Wallet & Ledger) :**
    *   Le Grand Livre (Ledger) enregistre chaque flux entrant/sortant.
    *   Logique de frais intégrée (1% sur les retraits et les paiements marchands).
2.  **Gestion de Trésorerie (Treasury & Minting) :**
    *   Possibilité d'émettre (Mint) de la monnaie numérique en échange de dépôts fiduciaires au siège de l'entreprise.
    *   Allocation de liquidité (Float) aux différentes agences pour éviter les ruptures de retraits (Cash-out).
3.  **Le Module "Guichet & Caisse" (Agences) :**
    *   Ouvertures et fermetures de sessions de caisse obligatoires par les agents (Teller).
    *   Rapprochement entre le Float (solde numérique) et les espèces (billets) dans le tiroir-caisse.
4.  **Produits Sociaux (L'avantage concurrentiel Mongain) :**
    *   **Caisses Communes (Joint Vaults) :** Cagnottes transparentes multi-utilisateurs.
    *   **Tontines (Épargne Rotative) :** Automatisation des prélèvements communautaires (anti-défaut de paiement).
5.  **Module KYC (Know Your Customer) :**
    *   Gestion anti-blanchiment (AML). Upload de pièces d'identité et de selfies. Accès aux photos pour validation par la Conformité ou vérification visuelle par l'Agent au guichet au moment d'un retrait.

## 3. SÉCURITÉ ET CONTRÔLE D'ACCÈS
Mongain dispose d'un niveau de sécurité de grade institutionnel (rare sur des Fintechs en démarrage) :

*   **Matrice RBAC (Role-Based Access Control) :**
    *   Les privilèges sont isolés en **32 permissions distinctes** (au lieu de simples rôles figés).
    *   Le Backend et le Frontend sont synchronisés (Une modification des droits masque l'interface UI et bloque l'API).
*   **Gestion des Sessions (JWT) :**
    *   Séparation stricte des middlewares : `authCorp` (pour les employés/CRM) et `authMiddleware` (pour les clients/app mobile).
    *   Fermeture forcée centralisée (via incrémentation du `jwtVersion` en base de données) : Geler un utilisateur déconnecte instantanément tous ses appareils.
*   **Circuit Breaker (Disjoncteur d'Urgence) :**
    *   Protection des routes financières critiques (retraits/transferts). Peut être activé en cas d'attaque ou de bug grave sans bloquer la consultation des comptes ou les Webhooks entrants.

## 4. DETTE TECHNIQUE ET AXES D'AMÉLIORATION (Diagnostic Actuel)
Bien que très solide, le projet présente des points d'attention cruciaux pour la mise en production à grande échelle (Scale) :

1.  **Fiabilité Financière (Transactions ACID) :**
    *   *Point fort :* L'utilisation de transactions Prisma garantit qu'un transfert ne peut pas décréditer l'un sans créditer l'autre.
    *   *Amélioration :* Implémenter le "Pessimistic Locking" (Verrous base de données pendant `CashOperationService`) pour empêcher le "Double Spend" si un utilisateur spam 10 fois très rapidement le bouton de "Validation".
2.  **Scalabilité de la Base de Données :**
    *   Le Ledger enregistre historiquement tout. La base de données Postgres va grandir de manière exponentielle avec l'adoption. Il faudra prévoir de l'archivage ou de la partition (Sharding) sur la table des Transactions dans les 2 prochaines années.
3.  **Tests Automatisés (QA) :**
    *   La suite de tests backend a été stabilisée (`npm test`), mais elle ne couvre pas encore tous les scénarios complexes (Tontines, Épidémie de rejets Click Pay). C'est le prochain gros rempart pour assurer un déploiement continu sans bugs (CI/CD).
4.  **Architecture Mobile (Expo) :**
    *   L'application est très lourde car elle embarque directement de nombreuses bibliothèques. Un nettoyage des dépendances mobiles et une transition vers un build optimisé (EAS Build minimaliste) réduira drastiquement la taille de l'APK.

---
**CONCLUSION :**
Sur le plan de l'architecture, l'application est formellement "Production-Ready". Ses mécanismes de sécurité (RBAC, Circuit Breaker) et sa logique métier (Caisse, Tontine) sont plus avancés et modulables que 90% des portefeuilles numériques lancés sur le continent. Le focus doit désormais se tourner vers la robustesse du réseau (tests automatisés étendus) et le développement commercial.
