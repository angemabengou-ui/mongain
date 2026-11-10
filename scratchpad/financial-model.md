# Modèle financier Mongain - Plan 2026-2031 (5 ans)

Toutes les valeurs sont exprimées en francs CFA (XAF, zone CEMAC) sur tout le document, sans changement de devise. Les tableaux utilisent soit les millions de FCFA (M FCFA), soit les milliards (Mds FCFA), précisé à chaque en-tête. Les chiffres sont arrondis au million le plus proche ; des écarts de +/- 1 M FCFA entre le détail et les totaux peuvent apparaître.

Mongain est un produit déjà construit (backend, application mobile, back-office de conformité) : transferts P2P, cash-in/cash-out via agents, Caisses Communes et Tontines, Comptes Enfant avec plafonds parentaux, logiciel de caisse (POS) gratuit pour commerçants, moteur KYC/anti-fraude et RBAC. Les mécaniques de monétisation utilisées ci-dessous sont vérifiées dans le code backend (taux de commission, formules de crédit, taux d'épargne, plafonds KYC), pas des hypothèses marketing.

---

## 1. Montant recherché et justification

**Montant recherché : 1 800 000 000 FCFA (1,8 milliard FCFA).**

Ce montant est construit de bas en haut, pas choisi arbitrairement. Le modèle (section 2) montre un besoin de trésorerie cumulé de 1 078 M FCFA entre l'Année 1 et l'Année 2 (avant que la Passerelle Mobile Money, les paiements de factures et le SaaS B2B ne montent en charge et ne fassent basculer l'EBITDA en territoire positif dès l'Année 3), auquel s'ajoute une avance de fonds de roulement de 300 M FCFA sur les deux premières années pour amorcer le livre de micro-crédit/BNPL avant que l'encours d'épargne bloquée (staking) ne soit assez large pour le refinancer en interne. Le solde, 620 M FCFA, constitue une réserve de trésorerie (environ 9 mois de charges au rythme de l'Année 2) qui garantit qu'aucun financement relais n'est nécessaire avant le point de bascule vers la rentabilité. Ce montant dépasse le plancher de 1,6 milliard FCFA fixé par les besoins réglementaires et de croissance, tout en restant un chiffre rond et défendable devant des investisseurs.

---

## 2. Plan d'affaires 5 ans

### 2.1 Utilisateurs, agents et effectifs

| Indicateur | Année 1 | Année 2 | Année 3 | Année 4 | Année 5 |
|---|---:|---:|---:|---:|---:|
| Utilisateurs inscrits (cumulés) | 35 000 | 140 000 | 350 000 | 650 000 | 1 000 000 |
| Utilisateurs actifs mensuels (MAU) | 12 000 | 60 000 | 175 000 | 360 000 | 580 000 |
| MAU / inscrits | 34 % | 43 % | 50 % | 55 % | 58 % |
| Répartition KYC : Tier 0 / Tier 1 / Tier 2 | 80/18/2 % | 65/30/5 % | 50/40/10 % | 40/45/15 % | 30/48/22 % |
| Agents actifs (cumulés) | 150 | 500 | 1 200 | 2 200 | 3 500 |
| Effectif (headcount) | 20 | 45 | 90 | 160 | 250 |

### 2.2 GMV (volume de transactions), en Mds FCFA

| Flux | Année 1 | Année 2 | Année 3 | Année 4 | Année 5 |
|---|---:|---:|---:|---:|---:|
| Transferts P2P / agents | 3,6 | 25,2 | 94,5 | 237,6 | 452,4 |
| Passerelle Mobile Money (Airtel/Moov)¹ | 0 | 10,8 | 52,5 | 151,2 | 313,2 |
| Factures & airtime¹ | 0 | 5,8 | 25,2 | 64,8 | 125,3 |
| Décaissements micro-crédit | 0,05 | 0,77 | 3,85 | 14,04 | 30,45 |
| Décaissements BNPL | 0,04 | 0,45 | 2,36 | 7,26 | 16,24 |
| Remittances (FX)² | 0 | 0 | 0,5 | 2,5 | 7,0 |
| Crypto (achat)³ | 0 | 0 | 0 | 0,2 | 0,8 |
| **GMV total** | **3,7** | **43,0** | **178,9** | **477,6** | **945,4** |
| *Pour mémoire : encours d'épargne bloquée (staking, fin d'année)* | *0,01* | *0,22* | *1,42* | *5,18* | *13,05* |

¹ Débloqué Année 2. ² Débloqué Année 3. ³ Débloqué Année 4 (achat seulement ; la vente est déjà active mais non matérielle). Voir section 4 pour le raisonnement.

Le take rate implicite (revenu total / GMV total) passe de 1,1 % en Année 1 à 1,18 % en Année 5, cohérent avec le taux de base de 1 % sur les transferts, tiré légèrement vers le haut par les lignes à marge plus élevée (intérêts de crédit, SaaS).

### 2.3 Revenus par flux (M FCFA)

| Flux (taux réel appliqué) | Année 1 | Année 2 | Année 3 | Année 4 | Année 5 |
|---|---:|---:|---:|---:|---:|
| Frais de transfert P2P/agent (1 %) | 36 | 252 | 945 | 2 376 | 4 524 |
| Intérêts micro-crédit (5 % flat) | 3 | 38 | 193 | 702 | 1 523 |
| Frais BNPL (5 % flat) | 2 | 23 | 118 | 363 | 812 |
| Spread flottant staking (net des intérêts versés) | 0 | 3 | 21 | 67 | 144 |
| SaaS B2B (POS multi-caisse, dès An. 2) | 0 | 36 | 144 | 360 | 720 |
| Passerelle Mobile Money (dès An. 2) | 0 | 54 | 263 | 756 | 1 566 |
| Factures & airtime (dès An. 2) | 0 | 69 | 302 | 778 | 1 503 |
| Cartes virtuelles (dès An. 3) | 0 | 0 | 15 | 70 | 180 |
| Remittances, marge FX (dès An. 3) | 0 | 0 | 10 | 50 | 140 |
| Crypto, marge sur achat (dès An. 4) | 0 | 0 | 0 | 3 | 12 |
| **Revenu total** | **41** | **475** | **2 011** | **5 525** | **11 124** |

### 2.4 Charges d'exploitation par catégorie (M FCFA)

| Catégorie | Année 1 | Année 2 | Année 3 | Année 4 | Année 5 |
|---|---:|---:|---:|---:|---:|
| Effectifs / RH | 180 | 378 | 734 | 1 286 | 1 980 |
| Marketing & acquisition (CAC) | 88 | 189 | 273 | 300 | 280 |
| Réseau d'agents (capex déploiement) | 23 | 53 | 98 | 130 | 156 |
| Conformité & licences (BEAC/COBAC, audits, AML) | 90 | 65 | 70 | 95 | 120 |
| Cloud / infrastructure | 20 | 45 | 110 | 230 | 420 |
| Intégrations partenaires (gateway, factures, cartes, remises) | 120 | 45 | 60 | 30 | 20 |
| **Charges totales** | **521** | **775** | **1 345** | **2 071** | **2 976** |

### 2.5 EBITDA et trésorerie cumulée (M FCFA)

| | Année 1 | Année 2 | Année 3 | Année 4 | Année 5 |
|---|---:|---:|---:|---:|---:|
| Revenu total | 41 | 475 | 2 011 | 5 525 | 11 124 |
| Charges totales | 521 | 775 | 1 345 | 2 071 | 2 976 |
| **EBITDA** | **-480** | **-300** | **666** | **3 454** | **8 148** |
| Marge EBITDA | n.s.* | n.s.* | 33 % | 63 % | 73 % |
| Fonds de roulement (seed trésorerie crédit/BNPL) | -150 | -150 | -100 | -50 | 0 |
| **Trésorerie cumulée (part depuis la levée de 1 800)** | **1 170** | **720** | **1 286** | **4 690** | **12 838** |

\* n.s. : non significatif, le revenu de base est trop faible en Année 1-2 pour qu'un ratio soit lisible ; la perte absolue est la donnée pertinente.

Le point bas de trésorerie se situe fin Année 2, à 720 M FCFA, soit un solde toujours positif : la levée de 1,8 Md FCFA couvre le creux avec marge, sans recours à un financement relais. À partir de l'Année 3, l'entreprise autofinance sa croissance et accumule un excédent de trésorerie (12,8 Mds FCFA fin Année 5), qui en pratique serait pour partie réinvesti dans l'accélération (expansion régionale, nouveaux produits) plutôt que conservé tel quel.

---

## 3. Emploi des fonds levés

### 3.1 Répartition de la levée (1 800 M FCFA), par catégorie et par année

| Catégorie | Année 1 | Année 2 | Année 3-5 | Total levée |
|---|---:|---:|---:|---:|
| Effectifs / RH | 220 | 160 | 0 | 380 |
| Marketing & CAC | 70 | 110 | 0 | 180 |
| Réseau d'agents (capex) | 20 | 35 | 0 | 55 |
| Conformité & licences | 90 | 25 | 0 | 115 |
| Intégrations partenaires (gateway Mobile Money en priorité) | 120 | 40 | 0 | 160 |
| Cloud / infrastructure | 15 | 25 | 0 | 40 |
| Fonds de roulement (seed crédit/BNPL/float) | 130 | 120 | 0 | 250 |
| Réserve de trésorerie (coussin de sécurité)⁴ | 620 | 0 | 0 | 620 |
| **Total levée** | **1 285** | **515** | **0** | **1 800** |

⁴ Reçue en totalité au closing (Année 1), conservée comme réserve non affectée ; mobilisable en Année 2-3 si l'exécution réelle est en retard sur le plan.

La totalité de la levée est allouée sur les deux premières années, la période où les charges dépassent structurellement les revenus. À partir de l'Année 3, la croissance est financée par les revenus d'exploitation (voir 3.2).

### 3.2 Réconciliation : dépense totale sur 5 ans, part levée vs part autofinancée (M FCFA)

| Catégorie | Total 5 ans (P&L) | dont financé par la levée | dont autofinancé par les revenus |
|---|---:|---:|---:|
| Effectifs / RH | 4 558 | 380 | 4 178 |
| Marketing & CAC | 1 130 | 180 | 950 |
| Réseau d'agents (capex) | 460 | 55 | 405 |
| Conformité & licences | 440 | 115 | 325 |
| Cloud / infrastructure | 825 | 40 | 785 |
| Intégrations partenaires | 275 | 160 | 115 |
| Fonds de roulement | 450 | 250 | 200 |
| **Sous-total catégories** | **8 138** | **1 180** | **6 958** |
| Réserve de trésorerie | - | 620 | - |
| **Total levée** | | **1 800** | |

Sur un besoin cumulé de 8 138 M FCFA de charges et de fonds de roulement sur 5 ans, 1 180 M FCFA (14,5 %) sont couverts par la levée et 6 958 M FCFA (85,5 %) par les revenus d'exploitation générés en cours de route, essentiellement à partir de l'Année 3.

---

## 4. Hypothèses explicites

**Courbe de croissance des utilisateurs et pourquoi.** La croissance part d'une base modeste (35 000 inscrits en Année 1, marché non encore assisté par la Passerelle Mobile Money) puis accélère fortement en Année 2 (x4) sous l'effet de deux boucles virales déjà intégrées au produit : les Caisses Communes/Tontines, où chaque cercle invite mécaniquement plusieurs nouveaux membres pour fonctionner, et les Comptes Enfant, où chaque parent inscrit entraîne l'inscription d'au moins un compte enfant. La croissance ralentit ensuite en rythme relatif (x2,5 en Année 3, x1,86 en Année 4, x1,54 en Année 5) à mesure que le marché adressable se sature, un schéma de courbe en S standard. Le ratio MAU/inscrits progresse de 34 % à 58 % à mesure que les cas d'usage (crédit, BNPL, épargne, factures) rendent l'app indispensable au quotidien plutôt qu'un simple outil de transfert occasionnel.

**Take rate.** Le taux de 1 % sur les transferts P2P/agents est celui déjà en place dans le backend (`taxP2P = 0.01`), avec gratuité pour les rechargements parent vers compte enfant. Il n'est pas modifié dans ce plan. Le take rate composite (revenu total/GMV) qui en résulte (1,1 % à 1,18 %) reflète simplement le mix des lignes à marge plus élevée qui montent en puissance (crédit, SaaS).

**ARPU par palier KYC (illustratif, FCFA/an, MAU).** L'ARPU moyen (revenu total/MAU) progresse de 3 417 FCFA en Année 1 à 19 179 FCFA en Année 5. En décomposant par palier avec un indice relatif d'intensité d'usage (Tier 1 = 3x Tier 0, Tier 2 = 6x Tier 0, cohérent avec des plafonds journaliers 40x et 100x supérieurs mais un usage réel très en-deçà des plafonds) :

| | Tier 0 | Tier 1 | Tier 2 | Moyenne pondérée |
|---|---:|---:|---:|---:|
| Année 1 | ~2 341 | ~7 023 | ~14 046 | 3 417 |
| Année 5 | ~6 268 | ~18 804 | ~37 608 | 19 179 |

La logique du produit incite à la montée en palier KYC : Tier 0 plafonne le portefeuille à 50 000 FCFA/jour, Tier 1 monte à 2 000 000 FCFA/jour après vérification d'identité, Tier 2 à 5 000 000 FCFA/jour. La proportion d'utilisateurs en Tier 1/Tier 2 passe de 20 % (Année 1) à 70 % (Année 5), ce qui tire l'ARPU moyen vers le haut mécaniquement.

**Réseau d'agents.** 150 agents en Année 1 (déploiement initial dans les zones urbaines de Libreville/Port-Gentil), montant à 3 500 en Année 5 au rythme de l'expansion vers les villes secondaires. Le réseau d'agents reste nécessaire même après l'ouverture de la Passerelle Mobile Money : une partie significative de la population gabonaise reste dépendante du cash-in/cash-out physique.

**Plan d'effectifs.** De 20 personnes (Année 1 : équipe technique, produit, conformité, opérations fondatrices) à 250 personnes (Année 5), avec un coût moyen chargé par employé de 660 000 à 750 000 FCFA/mois (le mix se déplace vers davantage de rôles opérationnels/support/lutte anti-fraude à mesure que le volume de transactions croît, ce qui fait légèrement baisser le coût moyen malgré la hausse du volume total).

**Hypothèse de CAC.** Le CAC moyen pondéré baisse de 2 500 FCFA/nouvel utilisateur (Année 1, acquisition majoritairement payante avant preuve de virilité) à 800 FCFA (Année 5), à mesure que le coefficient viral des Caisses Communes et des Comptes Enfant réduit la dépendance à l'acquisition payante. Ce chiffre est une hypothèse de travail à valider par des tests d'acquisition réels ; il n'est pas issu du code (contrairement aux taux de commission).

**Calendrier de déblocage des fonctionnalités actuellement gérées ("not yet integrated" dans le code) :**
- **Passerelle Mobile Money Airtel/Moov (Année 2).** Priorité n°1 d'usage des fonds (voir section 3). L'Année 1 est consacrée à la négociation commerciale avec les opérateurs, à l'intégration technique et à l'obtention des autorisations réglementaires BEAC/COBAC ; le déblocage est modélisé au début de l'Année 2, un calendrier de 9 à 15 mois post-closing jugé réaliste pour ce type de partenariat en zone CEMAC.
- **Paiement de factures (SEEG, Canal+, eau) et airtime (Année 2).** Regroupé avec la Passerelle Mobile Money car mobilisant le même agrégateur/les mêmes rails techniques ; le coût marginal d'intégration est faible une fois la Passerelle en place.
- **Cartes virtuelles (Année 3).** Nécessite un partenariat séparé avec un émetteur de cartes/sponsor BIN, un délai de mise en place plus long que la Passerelle Mobile Money.
- **Remittance internationale (Année 3).** Nécessite un partenaire de remise de fonds et une couche de conformité FX dédiée ; modélisée comme un revenu de marge de change, encore marginal en Année 3.
- **Achat de cryptoactifs (Année 4).** Volontairement placé en dernier et maintenu à un poids très faible dans le modèle (12 M FCFA de revenu en Année 5, contre 4 524 M FCFA pour les seuls frais de transfert) : la vente est déjà active en production, mais l'achat est explicitement une ligne spéculative et sensible sur le plan réglementaire, à ne pas surpondérer dans un dossier d'investisseurs.

**Simplifications assumées (à signaler à l'investisseur).** (i) Le livre de micro-crédit/BNPL est adossé à la Trésorerie Centrale dans le code (prêt = capital réel décaissé, pas seulement une commission) ; ce modèle traite son financement comme provenant principalement de l'encours d'épargne bloquée croissant (staking), complété par le fonds de roulement de la levée en Année 1-2, sans modéliser un bilan de pertes sur créances détaillé (taux de défaut). Un modèle de bilan complet avec provisionnement des impayés est recommandé comme prochaine itération. (ii) Le capex du réseau d'agents est passé en charge l'année de déploiement plutôt qu'amorti, une simplification usuelle à ce stade. (iii) Les points de fidélité (10 points = 1 FCFA) représentent un passif mineur, absorbé dans les charges générales, sans ligne dédiée. (iv) L'ampleur du GMV Année 5 (945 Mds FCFA, environ 7 % du PIB gabonais) est un scénario cible ambitieux mais benchmarké sur la trajectoire d'opérateurs mobile money dominants dans des petits marchés comparables ; si la pénétration réelle est deux fois plus lente, le calendrier de rentabilité glisse d'environ un an mais le montant de la levée (dimensionné sur le creux Année 1-2, peu sensible aux hypothèses Année 4-5) reste valable.

---

## 5. Scénario de rendement pour l'investisseur

**Méthode et avertissement.** La valorisation pré-money ci-dessous est estimée par un multiple du revenu prévisionnel (Année 2, première année de revenu significatif), une méthode usuelle en amorçage/série A pour une fintech africaine. **Ces multiples ne sont pas vérifiés contre des transactions comparables en temps réel et doivent être recoupés avec des données de marché à jour (levées récentes de fintechs comparables en Afrique subsaharienne/zone CEMAC/UEMOA) avant toute négociation.**

**Valorisation pré-money à l'entrée.**

| | Bas | Haut |
|---|---:|---:|
| Revenu Année 2 (base) | 475 M FCFA | 475 M FCFA |
| Multiple appliqué | 6x | 10x |
| **Valorisation pré-money** | **2 850 M FCFA** | **4 750 M FCFA** |
| + Levée | 1 800 M FCFA | 1 800 M FCFA |
| **Valorisation post-money** | **4 650 M FCFA** | **6 550 M FCFA** |
| **% détenu par les investisseurs de ce tour** | **38,7 %** | **27,5 %** |

Point médian retenu pour la suite : pré-money ~3 800 M FCFA, post-money ~5 600 M FCFA, soit environ **32 %** détenus par les investisseurs de ce tour.

**Scénario de sortie Année 5.** En appliquant un multiple de sortie délibérément conservateur de 3x à 5x le revenu Année 5 (8 148 M FCFA d'EBITDA sur 11 124 M FCFA de revenu suggèrent une entreprise rentable et attractive, mais un multiple plus élevé nécessiterait des comparables réels non disponibles ici) :

| | Bas | Haut |
|---|---:|---:|
| Revenu Année 5 | 11 124 M FCFA | 11 124 M FCFA |
| Multiple de sortie | 3x | 5x |
| **Valeur d'entreprise à la sortie** | **33 372 M FCFA** | **55 620 M FCFA** |
| Dilution supposée (tours ultérieurs Série A/B) : de 32 % à ~20 % | | |
| **Valeur de la participation des investisseurs de ce tour** | **6 674 M FCFA** | **11 124 M FCFA** |
| **Multiple de retour sur 1 800 M FCFA investis** | **3,7x** | **6,2x** |
| **TRI implicite sur 5 ans** | **~30 %** | **~44 %** |

Ce scénario est délibérément prudent : multiple de sortie bas (3-5x, pas 8-10x), dilution significative supposée (deux tours intermédiaires), et EBITDA Année 5 non capitalisé à sa pleine valeur. Il ne constitue pas une promesse de rendement, seulement un ordre de grandeur cohérent avec le modèle d'activité présenté en section 2, à affiner avec des comparables de marché réels.
