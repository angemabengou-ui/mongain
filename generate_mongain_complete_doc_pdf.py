# -*- coding: utf-8 -*-
"""
Générateur de la documentation PDF complète et exhaustive de l'application Mongain.
Génère un document de plus de 20 pages avec mise en page professionnelle (ReportLab).
"""

import os
import sys
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm, cm
from reportlab.lib.colors import HexColor, white, black
from reportlab.pdfgen import canvas
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle, KeepTogether, HRFlowable
)

OUTPUT_PDF = r"d:\Users\om0886\Desktop\mongain\Documentation_Complete_Mongain.pdf"

# Palette de couleurs Mongain FinTech
COLOR_PRIMARY = HexColor('#1E1B4B')     # Indigo très sombre
COLOR_ACCENT = HexColor('#4F46E5')      # Indigo vif
COLOR_ACCENT_LIGHT = HexColor('#EEF2FF')# Indigo très clair
COLOR_TEAL = HexColor('#0EA5E9')        # Cyan / Bleu ciel
COLOR_GREEN = HexColor('#10B981')       # Vert succès
COLOR_GREEN_BG = HexColor('#ECFDF5')
COLOR_YELLOW = HexColor('#F59E0B')      # Orange / Alerte
COLOR_YELLOW_BG = HexColor('#FFFBEB')
COLOR_RED = HexColor('#EF4444')         # Rouge danger
COLOR_RED_BG = HexColor('#FEF2F2')
COLOR_TEXT = HexColor('#1E293B')        # Ardoise foncée
COLOR_MUTED = HexColor('#64748B')       # Gris texte
COLOR_BORDER = HexColor('#E2E8F0')      # Bordure subtile
COLOR_CARD_BG = HexColor('#F8FAFC')     # Fond carte
COLOR_WHITE = HexColor('#FFFFFF')


class NumberedCanvas(canvas.Canvas):
    """Canvas personnalisé pour calculer le nombre total de pages et ajouter header/footer."""
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_page_decorations(num_pages)
            super().showPage()
        super().save()

    def draw_page_decorations(self, total_pages):
        # Ne pas afficher en-tête et pied de page sur la couverture (page 1)
        if self._pageNumber == 1:
            return

        self.saveState()
        page_w, page_h = A4

        # En-tête (Header)
        self.setFillColor(COLOR_ACCENT)
        self.rect(36, page_h - 38, page_w - 72, 1.5, fill=1, stroke=0)
        self.setFillColor(COLOR_MUTED)
        self.setFont('Helvetica-Bold', 8)
        self.drawString(36, page_h - 30, "MONGAIN FINTECH · DOCUMENTATION TECHNIQUE & FONCTIONNELLE COMPLETE")
        self.setFont('Helvetica', 8)
        self.drawRightString(page_w - 36, page_h - 30, "VERSION OFFICIELLE 2026")

        # Pied de page (Footer)
        self.setFillColor(COLOR_BORDER)
        self.rect(36, 42, page_w - 72, 1, fill=1, stroke=0)
        self.setFillColor(COLOR_MUTED)
        self.setFont('Helvetica', 8)
        self.drawString(36, 28, "Confidentiel — Usage Exclusif Mongain & Partenaires Agréés")
        page_str = f"Page {self._pageNumber} sur {total_pages}"
        self.drawRightString(page_w - 36, 28, page_str)

        self.restoreState()


def create_styles():
    """Initialise et retourne le dictionnaire de styles typographiques."""
    base = getSampleStyleSheet()

    styles = {
        'CoverTitle': ParagraphStyle(
            'CoverTitle',
            fontName='Helvetica-Bold',
            fontSize=32,
            leading=38,
            textColor=COLOR_WHITE,
            alignment=1, # Centré
            spaceAfter=14
        ),
        'CoverSubtitle': ParagraphStyle(
            'CoverSubtitle',
            fontName='Helvetica',
            fontSize=13,
            leading=18,
            textColor=HexColor('#CBD5E1'),
            alignment=1,
            spaceAfter=24
        ),
        'CoverBadge': ParagraphStyle(
            'CoverBadge',
            fontName='Helvetica-Bold',
            fontSize=10,
            leading=13,
            textColor=COLOR_ACCENT_LIGHT,
            alignment=1,
            spaceAfter=20
        ),
        'ChapterNumber': ParagraphStyle(
            'ChapterNumber',
            fontName='Helvetica-Bold',
            fontSize=11,
            leading=14,
            textColor=COLOR_ACCENT,
            spaceAfter=4,
            textTransform='uppercase'
        ),
        'ChapterTitle': ParagraphStyle(
            'ChapterTitle',
            fontName='Helvetica-Bold',
            fontSize=20,
            leading=24,
            textColor=COLOR_PRIMARY,
            spaceAfter=12
        ),
        'SectionTitle': ParagraphStyle(
            'SectionTitle',
            fontName='Helvetica-Bold',
            fontSize=13,
            leading=17,
            textColor=COLOR_ACCENT,
            spaceBefore=14,
            spaceAfter=8
        ),
        'SubSectionTitle': ParagraphStyle(
            'SubSectionTitle',
            fontName='Helvetica-Bold',
            fontSize=10.5,
            leading=14,
            textColor=COLOR_PRIMARY,
            spaceBefore=10,
            spaceAfter=5
        ),
        'Body': ParagraphStyle(
            'Body',
            fontName='Helvetica',
            fontSize=9.2,
            leading=13.5,
            textColor=COLOR_TEXT,
            spaceAfter=6
        ),
        'BodyBold': ParagraphStyle(
            'BodyBold',
            fontName='Helvetica-Bold',
            fontSize=9.2,
            leading=13.5,
            textColor=COLOR_PRIMARY,
            spaceAfter=6
        ),
        'Bullet': ParagraphStyle(
            'Bullet',
            fontName='Helvetica',
            fontSize=9.0,
            leading=13.0,
            textColor=COLOR_TEXT,
            leftIndent=14,
            firstLineIndent=-10,
            spaceAfter=4
        ),
        'CodeSnippet': ParagraphStyle(
            'CodeSnippet',
            fontName='Courier',
            fontSize=7.8,
            leading=10.5,
            textColor=COLOR_PRIMARY,
            backColor=COLOR_CARD_BG,
            borderColor=COLOR_BORDER,
            borderWidth=0.5,
            borderPadding=6,
            spaceBefore=4,
            spaceAfter=6
        ),
        'BoxText': ParagraphStyle(
            'BoxText',
            fontName='Helvetica',
            fontSize=8.8,
            leading=12.5,
            textColor=COLOR_TEXT
        ),
        'TableHead': ParagraphStyle(
            'TableHead',
            fontName='Helvetica-Bold',
            fontSize=8.2,
            leading=10.5,
            textColor=COLOR_WHITE,
            alignment=0
        ),
        'TableCell': ParagraphStyle(
            'TableCell',
            fontName='Helvetica',
            fontSize=8.0,
            leading=10.5,
            textColor=COLOR_TEXT
        ),
        'TableCellBold': ParagraphStyle(
            'TableCellBold',
            fontName='Helvetica-Bold',
            fontSize=8.0,
            leading=10.5,
            textColor=COLOR_PRIMARY
        ),
        'TableCellCode': ParagraphStyle(
            'TableCellCode',
            fontName='Courier',
            fontSize=7.5,
            leading=9.5,
            textColor=COLOR_ACCENT
        ),
        'TocChapter': ParagraphStyle(
            'TocChapter',
            fontName='Helvetica-Bold',
            fontSize=10,
            leading=14,
            textColor=COLOR_PRIMARY
        ),
        'TocPage': ParagraphStyle(
            'TocPage',
            fontName='Helvetica-Bold',
            fontSize=9.5,
            leading=14,
            textColor=COLOR_ACCENT,
            alignment=2
        ),
        'TocSub': ParagraphStyle(
            'TocSub',
            fontName='Helvetica',
            fontSize=8.5,
            leading=12,
            textColor=COLOR_MUTED,
            leftIndent=15
        )
    }
    return styles


def make_callout(text, title=None, kind="note", styles=None):
    """Crée un bloc d'information mis en valeur avec bordure latérale colorée."""
    bg_colors = {
        "note": COLOR_ACCENT_LIGHT,
        "warning": COLOR_YELLOW_BG,
        "danger": COLOR_RED_BG,
        "success": COLOR_GREEN_BG
    }
    bar_colors = {
        "note": COLOR_ACCENT,
        "warning": COLOR_YELLOW,
        "danger": COLOR_RED,
        "success": COLOR_GREEN
    }

    bg = bg_colors.get(kind, COLOR_CARD_BG)
    bar = bar_colors.get(kind, COLOR_ACCENT)

    elements = []
    if title:
        title_style = ParagraphStyle(
            'CalloutTitle',
            fontName='Helvetica-Bold',
            fontSize=9.2,
            leading=12,
            textColor=bar,
            spaceAfter=3
        )
        elements.append(Paragraph(title, title_style))

    p = Paragraph(text, styles['BoxText'])
    elements.append(p)

    tbl = Table([[elements]], colWidths=[175 * mm])
    tbl.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), bg),
        ('BOX', (0,0), (-1,-1), 0.5, COLOR_BORDER),
        ('LINELEFT', (0,0), (0,-1), 3.5, bar),
        ('TOPPADDING', (0,0), (-1,-1), 6),
        ('BOTTOMPADDING', (0,0), (-1,-1), 6),
        ('LEFTPADDING', (0,0), (-1,-1), 10),
        ('RIGHTPADDING', (0,0), (-1,-1), 10),
    ]))
    return tbl


def make_table(data, widths, is_header=True):
    """Crée une table stylisée pour le rapport."""
    t = Table(data, colWidths=widths, repeatRows=1 if is_header else 0)
    t_style = [
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('TOPPADDING', (0,0), (-1,-1), 4),
        ('BOTTOMPADDING', (0,0), (-1,-1), 4),
        ('LEFTPADDING', (0,0), (-1,-1), 5),
        ('RIGHTPADDING', (0,0), (-1,-1), 5),
        ('GRID', (0,0), (-1,-1), 0.5, COLOR_BORDER),
    ]
    if is_header:
        t_style.extend([
            ('BACKGROUND', (0,0), (-1,0), COLOR_ACCENT),
            ('TEXTCOLOR', (0,0), (-1,0), COLOR_WHITE),
        ])
    for i in range(1, len(data)):
        if i % 2 == 0:
            t_style.append(('BACKGROUND', (0, i), (-1, i), COLOR_CARD_BG))
    t.setStyle(TableStyle(t_style))
    return t


def build_pdf():
    print(f"[*] Début de la construction de la documentation PDF Mongain...")
    doc = SimpleDocTemplate(
        OUTPUT_PDF,
        pagesize=A4,
        leftMargin=18 * mm,
        rightMargin=18 * mm,
        topMargin=20 * mm,
        bottomMargin=20 * mm
    )

    styles = create_styles()
    story = []

    # =========================================================================
    # PAGE 1 : COUVERTURE OFFICIELLE
    # =========================================================================
    cover_data = [
        [Paragraph("DOCUMENTATION TECHNIQUE & FONCTIONNELLE INTEGRALE", styles['CoverBadge'])],
        [Spacer(1, 15 * mm)],
        [Paragraph("MONGAIN", styles['CoverTitle'])],
        [Paragraph("L'Ecosystème FinTech de Référence pour l'Afrique Centrale", styles['CoverSubtitle'])],
        [Spacer(1, 12 * mm)],
        [Paragraph("SPECIFICATION ARCHITECTURALE, LOGICIELLE & OPERATIONNELLE", ParagraphStyle('CoverSub2', fontName='Helvetica-Bold', fontSize=14, leading=18, textColor=COLOR_WHITE, alignment=1))],
        [Spacer(1, 6 * mm)],
        [Paragraph("Etude d'ingénierie exhaustive couvrant l'application mobile Expo SDK 57, les portails web React/Vite (Admin & Grands Marchands), le moteur backend Express/TypeScript, la base Neon PostgreSQL, les 16 modules métiers, les 5 robots CRON et les 200+ interfaces d'API REST.", ParagraphStyle('CoverDesc', fontName='Helvetica', fontSize=10, leading=15, textColor=HexColor('#E2E8F0'), alignment=1))],
        [Spacer(1, 20 * mm)],
        [
            Table([
                [
                    Paragraph("<b>Composants :</b> 4 sous-systèmes<br/><b>Modules mobiles :</b> 16 fonctionnalités", ParagraphStyle('CM1', fontName='Helvetica', fontSize=8.5, leading=12, textColor=COLOR_WHITE)),
                    Paragraph("<b>Tables BDD :</b> 30+ entités Prisma<br/><b>Routes API :</b> 39 contrôleurs REST", ParagraphStyle('CM2', fontName='Helvetica', fontSize=8.5, leading=12, textColor=COLOR_WHITE)),
                    Paragraph("<b>Date d'édition :</b> Octobre 2026<br/><b>Statut :</b> Production-Ready", ParagraphStyle('CM3', fontName='Helvetica', fontSize=8.5, leading=12, textColor=COLOR_WHITE)),
                ]
            ], colWidths=[55*mm, 55*mm, 55*mm], style=[
                ('BACKGROUND', (0,0), (-1,-1), HexColor('#312E81')),
                ('BOX', (0,0), (-1,-1), 1, HexColor('#6366F1')),
                ('TOPPADDING', (0,0), (-1,-1), 8),
                ('BOTTOMPADDING', (0,0), (-1,-1), 8),
                ('LEFTPADDING', (0,0), (-1,-1), 8),
                ('RIGHTPADDING', (0,0), (-1,-1), 8),
            ])
        ]
    ]

    cover_table = Table(cover_data, colWidths=[175 * mm])
    cover_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), COLOR_PRIMARY),
        ('ALIGN', (0,0), (-1,-1), 'CENTER'),
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('TOPPADDING', (0,0), (-1,-1), 25 * mm),
        ('BOTTOMPADDING', (0,0), (-1,-1), 25 * mm),
        ('LEFTPADDING', (0,0), (-1,-1), 10 * mm),
        ('RIGHTPADDING', (0,0), (-1,-1), 10 * mm),
    ]))
    story.append(cover_table)
    story.append(PageBreak())

    # =========================================================================
    # PAGE 2 : SOMMAIRE GENERAL (TABLE DES MATIERES)
    # =========================================================================
    story.append(Paragraph("TABLE DES MATIERES", styles['ChapterTitle']))
    story.append(HRFlowable(width="100%", thickness=1.5, color=COLOR_ACCENT, spaceBefore=2, spaceAfter=12))

    toc_items = [
        ("1. ARCHITECTURE TECHNIQUE GLOBALE", "Composants, flux réseau, environnements et pile logicielle", "Page 3"),
        ("2. MODELE DES ROLES & GOUVERNANCE RBAC", "Acteurs clients, hiérarchie marchande, matrice staff et privilèges", "Page 4"),
        ("3. SUITE COMPLETE APPLICATION MOBILE (16 MODULES)", "Spécification détaillée des 16 modules fonctionnels de l'APK client", "Page 6"),
        ("   3.1 Inscription, Connexion & Sécurité 2FA / KYC", "Parcours d'enrôlement, OTP SMS, PIN et vérification d'identité", "Page 6"),
        ("   3.2 Portefeuille Numérique (Wallet) & Moteur de Plafonds", "Grand livre personnel, LimitEngine, consultations et historiques", "Page 6"),
        ("   3.3 Virements P2P & Mouvements de Fonds Sécurisés", "Transferts instantanés, idempotence, notifications de débits", "Page 7"),
        ("   3.4 Encaissement Marchand par Scan QR & Guichet", "Protocole de scan, autorisation par PIN client, flux caisse", "Page 7"),
        ("   3.5 Division Communautaire de Notes (Split)", "Partage équitable ou proportionnel de dépenses collectives", "Page 8"),
        ("   3.6 Tontines Digitalisées & Cycles Automatisés", "Epargne rotative, tirage séquentiel, votes et pénalités de retard", "Page 8"),
        ("   3.7 Caisses Communes d'Epargne (Vaults)", "Coffres d'objectifs, gouvernance partagée et validation de retraits", "Page 9"),
        ("   3.8 Moteur d'Octroi de Micro-Crédits Instantanés", "Algorithme d'éligibilité, scoring de solvabilité et recouvrement", "Page 9"),
        ("   3.9 Paiement Fractionné BNPL (Buy Now Pay Later)", "Contrats d'échéanciers à taux fixe (5%) et gestion du contentieux", "Page 10"),
        ("   3.10 Transferts Transfrontaliers & Remittance FX", "Corridors de devises (XAF, XOF, EUR, USD), marges de change", "Page 10"),
        ("   3.11 Paiement de Factures & Services Partenaires", "Raccordement SEEG, Canal+, et recharges téléphoniques", "Page 11"),
        ("   3.12 Programme de Fidélité & Conversion de Points", "Barème d'accumulation, conversion en XAF et déverrouillage crédit", "Page 11"),
        ("   3.13 Comptes Famille & Tutelle Parentale", "Comptes enfants rattachés, plafonnement et surveillance push", "Page 12"),
        ("   3.14 Cartes Bancaires Virtuelles", "Emission dématérialisée, approvisionnement et gel dynamique", "Page 12"),
        ("   3.15 Comptes à Terme & Staking Rémunéré", "Blocage de liquidité (1 à 60 mois), APY 5% et libération", "Page 13"),
        ("   3.16 Passerelle Téléphonique USSD & Inclusivité", "Interface SS7 sans data pour zones blanches et téléphones basiques", "Page 13"),
        ("4. LE PORTAIL DES GRANDS MARCHANDS (MERCHANT PORTAL)", "Console de gestion pour mairies, régies et grandes entreprises", "Page 14"),
        ("   4.1 Affiliations de Petits Marchands & Prélèvement Auto-Pay", "Perception de redevances, conformité et alertes d'impayés", "Page 14"),
        ("   4.2 Payroll Salariés en Masse & Guichets Physiques (Tills)", "Traitement par lot CSV et caisses enregistreuses déportées", "Page 15"),
        ("5. PORTAIL D'ADMINISTRATION & SUPERVISION CENTRALE", "Console de pilotage siège (Staff Mongain)", "Page 16"),
        ("   5.1 Dashboard Présidentiel de Supervision Globale", "Contrôle macroscopique des géants, récoltes et indicateurs vitaux", "Page 16"),
        ("   5.2 Vue Client 360°, Conformité KYC & Lutte Anti-Fraude", "Audit complet des comptes, gel conservatoire et scoring AML", "Page 17"),
        ("   5.3 Trésorerie Centrale en Partie Double (MINT/BURN)", "Gestion de la voûte d'adossement et circuit Maker/Checker", "Page 18"),
        ("   5.4 Terminal Caissier d'Agence & Clôture de Caisse", "Gestion des espèces physiques, sessions et billetterie", "Page 19"),
        ("6. MOTEUR CRON & AUTOMATISATIONS D'ARRIERE-PLAN", "Orchestration quotidienne des échéances et des recouvrements", "Page 20"),
        ("7. MATRICE DE CYBERSECURITE & INTEGRITE FINANCIERE", "Chiffrement, anti-rejeu, isolation des sessions et résilience", "Page 21"),
        ("8. ECOSYSTEME D'INTEGRATIONS & INFRASTRUCTURE CLOUD", "PVit, Expo Push, SMS, Neon Postgres et passerelles télécoms", "Page 22"),
        ("9. SCHEMA RELATIONNEL DE LA BASE DE DONNEES", "Cartographie des 30+ tables et relations du modèle Prisma", "Page 23"),
        ("10. DICTIONNAIRE DETAILLE DES INTERFACES D'API REST", "Inventaire structuré des 200+ points de terminaison", "Page 24"),
        ("11. MANUEL DE DEPLOIEMENT & EXPLOITATION OPERATIONNELLE", "Guide de démarrage local, production Render et maintenance BDD", "Page 26"),
        ("12. GLOSSAIRE TERMINOLOGIQUE & CONCEPTS METIERS FINTECH", "Définition exhaustive des 20 notions clés de l'écosystème", "Page 27"),
        ("13. REFERENTIEL DES CODES D'ERREUR, STATUTS & DEPANNAGE (P0)", "Matrice des erreurs HTTP, statuts d'ordres et plan de reprise", "Page 28"),
    ]

    for title, desc, pg in toc_items:
        is_main = not title.startswith("   ")
        if is_main:
            story.append(Spacer(1, 3))
            t_row = Table([
                [Paragraph(title, styles['TocChapter']), Paragraph(pg, styles['TocPage'])]
            ], colWidths=[145*mm, 30*mm])
            t_row.setStyle(TableStyle([
                ('VALIGN', (0,0), (-1,-1), 'BOTTOM'),
                ('LINEBELOW', (0,0), (-1,-1), 0.5, HexColor('#CBD5E1')),
                ('BOTTOMPADDING', (0,0), (-1,-1), 2),
            ]))
            story.append(t_row)
            story.append(Paragraph(desc, styles['TocSub']))
        else:
            t_sub = Table([
                [Paragraph(title, styles['TocSub']), Paragraph(pg, ParagraphStyle('TPGSub', fontName='Helvetica', fontSize=8, leading=10, textColor=COLOR_MUTED, alignment=2))]
            ], colWidths=[145*mm, 30*mm])
            t_sub.setStyle(TableStyle([
                ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
                ('BOTTOMPADDING', (0,0), (-1,-1), 1),
            ]))
            story.append(t_sub)

    story.append(PageBreak())

    # =========================================================================
    # CHAPITRE 1 : ARCHITECTURE TECHNIQUE GLOBALE
    # =========================================================================
    story.append(Paragraph("CHAPITRE 1", styles['ChapterNumber']))
    story.append(Paragraph("Architecture Technique Globale", styles['ChapterTitle']))
    story.append(HRFlowable(width="100%", thickness=1.5, color=COLOR_ACCENT, spaceBefore=2, spaceAfter=10))

    story.append(Paragraph(
        "L'application Mongain est une plateforme financière multiservice distribuée, conçue selon les normes "
        "bancaires d'intégrité, de disponibilité et de traçabilité. Elle permet de bancariser les populations "
        "d'Afrique Centrale en intégrant la monnaie électronique, l'épargne rotative tontinière, le paiement de "
        "proximité, le micro-financement et la gouvernance institutionnelle des marchés.",
        styles['Body']
    ))

    story.append(Paragraph("1.1 Les Quatre Composants Primaires", styles['SectionTitle']))

    comp_data = [
        [
            Paragraph("Composant", styles['TableHead']),
            Paragraph("Technologie", styles['TableHead']),
            Paragraph("Rôle & Responsabilités", styles['TableHead']),
            Paragraph("Environnement", styles['TableHead'])
        ],
        [
            Paragraph("Application Mobile", styles['TableCellBold']),
            Paragraph("Expo SDK 57<br/>React Native<br/>TypeScript", styles['TableCell']),
            Paragraph("Interface utilisateur grand public et marchands de proximité. Déployée sous forme d'APK natif Android et bundle iOS. Gère les interactions tactiles, le scan QR bidirectionnel, le stockage sécurisé (SecureStore) et la biométrie.", styles['TableCell']),
            Paragraph("Mobile natif<br/>APK distribué", styles['TableCell'])
        ],
        [
            Paragraph("Backend API Core", styles['TableCellBold']),
            Paragraph("Node.js 22 LTS<br/>Express, Prisma ORM<br/>Socket.IO, TypeScript", styles['TableCell']),
            Paragraph("Moteur transactionnel central. Gère l'authentification forte, le grand livre (Ledger), le LimitEngine, les transactions atomiques PostgreSQL, les tâches de fond CRON, les webhooks financiers et la communication WebSocket temps réel.", styles['TableCell']),
            Paragraph("Port 3000 local<br/>Render.com Prod", styles['TableCell'])
        ],
        [
            Paragraph("Admin Web Hub", styles['TableCellBold']),
            Paragraph("React 18, Vite<br/>Lucide Icons<br/>TypeScript", styles['TableCell']),
            Paragraph("Console d'exploitation pour le personnel de Mongain (Staff). Permet la gestion des agences, la supervision de la réserve centrale de trésorerie (MINT/BURN), la validation KYC/AML, le support client, le grand livre et le terminal de caisse guichet.", styles['TableCell']),
            Paragraph("Port 5173 local<br/>Console Staff", styles['TableCell'])
        ],
        [
            Paragraph("Portail Grand Marchand", styles['TableCellBold']),
            Paragraph("React 18, Vite<br/>TypeScript", styles['TableCell']),
            Paragraph("Extranet destiné aux organisations institutionnelles et marchands d'envergure (Mairies, syndicats de commerçants, régies financières). Gère les réseaux de marchands affiliés, les prélèvements de taxes, le payroll de masse et les guichets multiples.", styles['TableCell']),
            Paragraph("Port 5174 local<br/>Espace Géant", styles['TableCell'])
        ]
    ]
    story.append(make_table(comp_data, [35*mm, 35*mm, 75*mm, 30*mm]))

    story.append(Spacer(1, 4))
    story.append(Paragraph("1.2 Topologie Réseau & Flux de Communication", styles['SectionTitle']))
    story.append(Paragraph(
        "L'infrastructure est scindée en deux environnements complémentaires :<br/>"
        "• <b>Production :</b> L'application mobile cible en permanence le domaine sécurisé "
        "<code>https://mongain-backend.onrender.com</code>. Le backend y opère derrière un reverse proxy gérant le "
        "certificat SSL/TLS et transmettant les adresses IP réelles via <code>trust proxy = 1</code>.<br/>"
        "• <b>Développement & Exploitation Locale :</b> L'écosystème peut être instancié localement sur une station d'ingénierie "
        "via des scripts d'orchestration (fichiers <code>.bat</code>) hébergeant conjointement les 4 serveurs sur les ports 3000, 5173, 5174 et Metro bundler 8081.",
        styles['Body']
    ))

    story.append(make_callout(
        "<b>Règle de persistance :</b> Les deux environnements s'appuient sur l'instance Neon PostgreSQL hébergée dans le Cloud. "
        "Toutes les écritures financières sont exécutées avec une sémantique ACID sous verrouillage pessimiste ou vérification d'idempotence.",
        "PERSISTANCE BANCAIRE", "note", styles
    ))

    story.append(PageBreak())

    # =========================================================================
    # CHAPITRE 2 : MODELE DES ROLES & GOUVERNANCE RBAC
    # =========================================================================
    story.append(Paragraph("CHAPITRE 2", styles['ChapterNumber']))
    story.append(Paragraph("Modèle des Rôles & Gouvernance RBAC", styles['ChapterTitle']))
    story.append(HRFlowable(width="100%", thickness=1.5, color=COLOR_ACCENT, spaceBefore=2, spaceAfter=10))

    story.append(Paragraph(
        "La plateforme implémente une étanchéité stricte entre les clients finaux (utilisateurs mobiles, marchands) "
        "et les opérateurs internes (personnel de banque, caissiers, auditeurs, analystes risque). "
        "Cette séparation est matérialisée par deux tables indépendantes : <code>User</code> et <code>Staff</code>.",
        styles['Body']
    ))

    story.append(Paragraph("2.1 Typologie des Comptes Utilisateurs (Table User)", styles['SectionTitle']))

    user_roles_data = [
        [Paragraph("Rôle / Tiers", styles['TableHead']), Paragraph("Code Système", styles['TableHead']), Paragraph("Capacités & Périmètre Opérationnel", styles['TableHead'])],
        [
            Paragraph("Client Standard", styles['TableCellBold']),
            Paragraph("USER", styles['TableCellCode']),
            Paragraph("Utilisateur particulier standard. Détient un portefeuille principal (Wallet), réalise des transferts P2P, cotise à des tontines, participe à des caisses communes, sollicite des micro-crédits et effectue des paiements marchands par QR.", styles['TableCell'])
        ],
        [
            Paragraph("Marchand de Proximité", styles['TableCellBold']),
            Paragraph("MERCHANT<br/>(Tier standard)", styles['TableCellCode']),
            Paragraph("Commerçant de détail, boutiquier, étal de marché. Dispose en sus d'un CommissionWallet. Encaisse les règlements clients via son QR code personnel ou un terminal de caisse, et peut s'affilier à un Grand Marchand pour s'acquitter de redevances.", styles['TableCell'])
        ],
        [
            Paragraph("Grand Marchand (Géant)", styles['TableCellBold']),
            Paragraph("MERCHANT<br/>merchantTier = 'GIANT'", styles['TableCellCode']),
            Paragraph("Organisme à rayonnement étendu (Mairie, collectivité, grossiste, grande enseigne). Accède au portail web dédié (Port 5174), affilie des centaines de petits marchands, prélève automatiquement des taxes de marché et exécute des virements salariaux de masse.", styles['TableCell'])
        ],
        [
            Paragraph("Agent de Terrain", styles['TableCellBold']),
            Paragraph("AGENT", styles['TableCellCode']),
            Paragraph("Point de contact physique pour le rechargement (Cash-In) et le désengagement (Cash-Out) des liquidités physiques contre monnaie électronique. Rattaché à une succursale bancaire ou autonome.", styles['TableCell'])
        ],
        [
            Paragraph("Compte Enfant (Mineur)", styles['TableCellBold']),
            Paragraph("CHILD<br/>(avec parentId)", styles['TableCellCode']),
            Paragraph("Compte mineur supervisé par un compte parent. Plafonds de dépenses restreints, interdiction formelle de créer des tontines ou des caisses communes. Chaque débit génère une alerte push temps réel sur le mobile du parent tuteur.", styles['TableCell'])
        ]
    ]
    story.append(make_table(user_roles_data, [40*mm, 40*mm, 95*mm]))

    story.append(Spacer(1, 4))
    story.append(Paragraph("2.2 Hiérarchie du Personnel & Matrice des Privilèges Staff", styles['SectionTitle']))

    staff_roles_data = [
        [Paragraph("Rôle Staff", styles['TableHead']), Paragraph("Rôle d'Usage", styles['TableHead']), Paragraph("Permissions & Attribution Fonctionnelle", styles['TableHead'])],
        [
            Paragraph("SUPER_ADMIN", styles['TableCellBold']),
            Paragraph("Président / DG", styles['TableCell']),
            Paragraph("Privilèges absolus sur l'intégralité du système. Approbation des injections monétaires (MINT/BURN), supervision globale des récoltes marchandes, administration des agences et configuration des taux.", styles['TableCell'])
        ],
        [
            Paragraph("RISK", styles['TableCellBold']),
            Paragraph("Analyste Risque", styles['TableCell']),
            Paragraph("Surveillance macroéconomique, monitoring des taux d'impayés, analyse du risque de crédit, consultation des flux suspects et évaluation de solvabilité.", styles['TableCell'])
        ],
        [
            Paragraph("COMPLIANCE_CHECKER", styles['TableCellBold']),
            Paragraph("Officier Conformité", styles['TableCell']),
            Paragraph("Traitement et homologation des dossiers KYC (niveaux 1 et 2), contrôle d'identité, signalement d'opérations suspectes (AML / LCB-FT) et gel préventif de comptes.", styles['TableCell'])
        ],
        [
            Paragraph("SUPPORT_MAKER", styles['TableCellBold']),
            Paragraph("Support Client", styles['TableCell']),
            Paragraph("Prise en charge des réclamations usagers, visualisation du dossier Client 360°, rédaction de notes d'audit internes et réinitialisation sécurisée de codes PIN égarés.", styles['TableCell'])
        ],
        [
            Paragraph("BRANCH_MANAGER", styles['TableCellBold']),
            Paragraph("Chef d'Agence", styles['TableCell']),
            Paragraph("Gestion d'une succursale physique, contrôle des encaissements d'espèces, arbitrage de liquidités guichets et approbation des clôtures journalières de caisse.", styles['TableCell'])
        ],
        [
            Paragraph("TELLER", styles['TableCellBold']),
            Paragraph("Caissier Guichet", styles['TableCell']),
            Paragraph("Exploitation du terminal caisse : ouverture de session, dépôt d'espèces (Cash-In), paiement de retraits par code OTP (Cash-Out) et arrêtés comptables.", styles['TableCell'])
        ]
    ]
    story.append(make_table(staff_roles_data, [40*mm, 35*mm, 100*mm]))

    story.append(PageBreak())

    # =========================================================================
    # CHAPITRE 3 : SUITE COMPLETE APPLICATION MOBILE (16 MODULES)
    # =========================================================================
    story.append(Paragraph("CHAPITRE 3", styles['ChapterNumber']))
    story.append(Paragraph("Suite Complète Application Mobile (16 Modules)", styles['ChapterTitle']))
    story.append(HRFlowable(width="100%", thickness=1.5, color=COLOR_ACCENT, spaceBefore=2, spaceAfter=10))

    story.append(Paragraph(
        "L'application mobile Mongain fédère 16 briques fonctionnelles conçues pour répondre à l'ensemble "
        "des besoins transactionnels du quotidien en Afrique Centrale.",
        styles['Body']
    ))

    # --- 3.1 AUTHENTIFICATION ---
    story.append(Paragraph("3.1 Inscription, Connexion & Sécurité 2FA / KYC", styles['SectionTitle']))
    story.append(Paragraph(
        "• <b>Enrôlement Téléphonique :</b> L'usager fournit son numéro de téléphone gabonais (Airtel ou Moov). "
        "Le système normalise automatiquement le préfixe (+241) et transmet un OTP numérique à 4 chiffres par SMS.<br/>"
        "• <b>Établissement du Code Secret :</b> Après vérification de l'OTP, l'utilisateur configure un code PIN confidentiel à 4 chiffres, "
        "chiffré avec <code>bcryptjs</code> (facteur de coût 12). Un identifiant unique <code>username</code> est réservé.<br/>"
        "• <b>Défense Anti-Brute Force :</b> Le système applique un verrouillage automatique de 15 minutes dès le 3ème mot de passe ou PIN erroné. "
        "De plus, l'émission des SMS d'OTP est limitée par IP et par numéro (5 requêtes maximum par heure).<br/>"
        "• <b>Système KYC Gradué :</b><br/>"
        "  - <i>KYC Niveau 0 :</i> Inscription initiale non certifiée (plafonds stricts, pas d'accès au crédit).<br/>"
        "  - <i>KYC Niveau 1 :</i> Téléversement d'une pièce d'identité nationale (CNI) ou passeport en cours de validité.<br/>"
        "  - <i>KYC Niveau 2 :</i> Validation biométrique et justificatif de domicile validé par le personnel de conformité, octroyant les plafonds maximaux.",
        styles['Body']
    ))

    # --- 3.2 WALLET ---
    story.append(Paragraph("3.2 Portefeuille Numérique (Wallet) & Moteur de Plafonds", styles['SectionTitle']))
    story.append(Paragraph(
        "• <b>Comptabilité Intégrale en FCFA :</b> Aucun centime n'existe dans la devise XAF. Toutes les balances "
        "(<code>Wallet.balance</code>) et montants de transaction sont impérativement typés en entiers relatifs (<code>Int</code>) "
        "dans Prisma et validés avec <code>Math.round()</code> côté Node.js pour éradiquer tout biais d'arrondi décimal.<br/>"
        "• <b>Moteur de Plafonds LimitEngine :</b> Chaque tentative de débit interroge le <code>LimitEngine</code> qui évalue :<br/>"
        "  1. Le montant unitaire de l'opération comparé au plafond par transaction du palier KYC.<br/>"
        "  2. Le cumul des débits réalisés sur les dernières 24 heures glissantes (Plafond Journalier).<br/>"
        "  3. Le cumul des débits sur les 30 derniers jours (Plafond Mensuel).<br/>"
        "En cas de dépassement, la transaction est instantanément rejetée avec un message explicite.",
        styles['Body']
    ))

    # --- 3.3 VIREMENTS P2P ---
    story.append(Paragraph("3.3 Virements P2P & Mouvements de Fonds Sécurisés", styles['SectionTitle']))
    story.append(Paragraph(
        "• <b>Transfert Instantané de Compte à Compte :</b> L'expéditeur sélectionne le destinataire par numéro de téléphone "
        "ou depuis son répertoire synchronisé via l'API <code>/match-contacts</code>.<br/>"
        "• <b>Validation par PIN Serveur :</b> Le transfert requiert la saisie du code PIN de l'expéditeur, vérifié à chaud côté backend.<br/>"
        "• <b>Protection Anti-Rejeu (Idempotence) :</b> Le mobile transmet un jeton UUID <code>idempotencyKey</code>. Si une coupure réseau "
        "survient et que l'utilisateur renvoie la requête, le backend identifie la transaction déjà exécutée et retourne le statut sans re-débiter.<br/>"
        "• <b>Frais et Trésorerie Corporate :</b> Les frais de virement sont calculés dynamiquement selon les grilles de <code>SystemSettings</code> "
        "et crédités en temps réel sur le compte système <code>CORPORATE</code>.",
        styles['Body']
    ))

    story.append(PageBreak())

    # --- 3.4 PAIEMENT MARCHAND QR ---
    story.append(Paragraph("3.4 Encaissement Marchand par Scan QR & Guichet", styles['SectionTitle']))
    story.append(Paragraph(
        "Le protocole de paiement de proximité inverse le modèle classique pour maximiser la sécurité :<br/>"
        "1. Le client présente son QR code personnel dynamique généré sur son écran mobile.<br/>"
        "2. Le commerçant scanne le QR code avec l'appareil photo de son application ou depuis son terminal caisse (Till).<br/>"
        "3. Le commerçant spécifie la somme à percevoir en FCFA.<br/>"
        "4. <b>Autorisation Impérative :</b> Le client saisit personnellement son code PIN secret sur le terminal ou valide sur son propre smartphone. "
        "Le marchand n'a jamais accès au PIN du consommateur.<br/>"
        "5. Le solde du client est débité et le <code>Wallet</code> du marchand est crédité du montant net, la commission revenant à la plateforme.",
        styles['Body']
    ))

    # --- 3.5 SPLIT ---
    story.append(Paragraph("3.5 Division Communautaire de Notes (Split Payment)", styles['SectionTitle']))
    story.append(Paragraph(
        "Permet de scinder une dépense globale (ex: repas au restaurant de 30 000 FCFA) entre plusieurs convives :<br/>"
        "• L'initiateur émet une requête <code>POST /api/split/request</code> en listant les numéros de téléphone cibles et la part individuelle attendue.<br/>"
        "• Chaque destinataire reçoit une notification push et retrouve la facture dans son onglet 'En attente'.<br/>"
        "• Le règlement individuel s'effectue par simple validation PIN, apurant la créance en temps réel.",
        styles['Body']
    ))

    # --- 3.6 TONTINES ---
    story.append(Paragraph("3.6 Tontines Digitalisées & Cycles Automatisés", styles['SectionTitle']))
    story.append(Paragraph(
        "Transposition numérique de la tontine rotative africaine traditionnelle (Djangui, Pari) :<br/>"
        "• <b>Structure de Groupe :</b> Un créateur initialise une tontine avec une fréquence (HEBDOMADAIRE ou MENSUELLE), une mise unitaire fixe "
        "et un statut (public dans l'annuaire ou privé sur invitation).<br/>"
        "• <b>Tirage Séquentiel (Ordre de Versement) :</b> Les membres se voient attribuer un rang d'encaissement (payoutOrder). À chaque tour de cycle, "
        "l'ensemble des cotisations est prélevé et la cagnotte globale est créditée sur le wallet du bénéficiaire désigné.<br/>"
        "• <b>Vote Démocratique de Renouvellement :</b> En fin de boucle complète, un scrutin électronique (<code>POST /renewal-vote</code>) est ouvert. "
        "Si l'unanimité ou la majorité configurée vote 'RENEW', un nouveau cycle démarre sans réinscription manuelle.",
        styles['Body']
    ))

    # --- 3.7 CAISSE COMMUNE (VAULT) ---
    story.append(Paragraph("3.7 Caisses Communes d'Épargne Collective (Vaults)", styles['SectionTitle']))
    story.append(Paragraph(
        "Contrairement à la tontine rotative, la Caisse Commune est un coffre-fort d'accumulation financière destiné à un objectif de groupe "
        "(association, projet immobilier familial, fonds de solidarité) :<br/>"
        "• Dépôt libre ou programmé par n'importe quel membre accrédité.<br/>"
        "• <b>Retraits sous Scrutin Collégial :</b> Tout décaissement requiert une demande préalable (<code>POST /withdraw-request</code>) "
        "qui déclenche un vote obligatoire des administrateurs du coffre (<code>POST /approve/:txId</code>). "
        "Aucun membre individuel ne peut fuiter les capitaux unilatéralement.",
        styles['Body']
    ))

    story.append(PageBreak())

    # --- 3.8 MICRO-CREDIT ---
    story.append(Paragraph("3.8 Moteur d'Octroi de Micro-Crédits Instantanés", styles['SectionTitle']))
    story.append(Paragraph(
        "Mongain intègre une technologie de prêt d'urgence sans garantie physique, arbitrée par algorithme :<br/>"
        "• <b>Conditions d'Éligibilité Automatique :</b><br/>"
        "  1. Authentification KYC Niveau 1 minimum requise.<br/>"
        "  2. Solde de points de fidélité <code>loyaltyPoints >= 100</code>.<br/>"
        "  3. Score algorithmique de risque <code>score >= 400</code> (hors catégorie 'High Risk').<br/>"
        "  4. Absence absolue de créance en souffrance (aucun prêt ou contrat BNPL en état <code>DEFAULTED</code>).<br/>"
        "• <b>Plafond Dynamique :</b> Calculé selon la formule <code>Max = 50 000 + (loyaltyPoints * 50)</code> FCFA, plafonné à 500 000 FCFA.<br/>"
        "• <b>Durée et Remboursement :</b> Maturité standard fixée à 30 jours calendaires. Remboursement direct via le solde disponible.",
        styles['Body']
    ))

    # --- 3.9 BNPL ---
    story.append(Paragraph("3.9 Paiement Fractionné BNPL (Buy Now Pay Later)", styles['SectionTitle']))
    story.append(Paragraph(
        "Le module BNPL autorise les achats échelonnés en plusieurs mensualités :<br/>"
        "• Montant maximal fixé à 50 000 FCFA par engagement.<br/>"
        "• Majoration d'intérêt forfaitaire de 5% (flat fee) amortie sur l'échéancier.<br/>"
        "• Règle d'engagement unique : Un seul contrat actif toléré simultanément par consommateur.",
        styles['Body']
    ))

    # --- 3.10 REMITTANCE ---
    story.append(Paragraph("3.10 Transferts Transfrontaliers & Remittance FX", styles['SectionTitle']))
    story.append(Paragraph(
        "Module d'émission de transferts de fonds internationaux :<br/>"
        "• Cotation préalable transparente via <code>POST /api/remit/quote</code> stipulant le taux appliqué et la marge de change.<br/>"
        "• Parité fixe 1:1 vers les territoires de l'UEMOA (CFA BCEAO / XOF).<br/>"
        "• Corridors de conversion vers l'Euro (EUR, taux 0.001524) et le Dollar Américain (USD, taux 0.0017).",
        styles['Body']
    ))

    # --- 3.11 SERVICES ---
    story.append(Paragraph("3.11 Raccordement aux Facturiers de Services Publics", styles['SectionTitle']))
    story.append(Paragraph(
        "Architecture de paiement de factures utilitaires (SEEG pour l'eau et les compteurs d'électricité Edan, abonnements Canal+, recharges téléphoniques). "
        "Le contrôleur intègre un commutateur de protection <code>ENABLE_UNVERIFIED_EXTERNAL_SERVICES</code> neutralisant les transactions tant "
        "que les accords d'interconnexion API réels avec les opérateurs ne sont pas scellés.",
        styles['Body']
    ))

    # --- 3.12 FIDELITE ---
    story.append(Paragraph("3.12 Programme de Fidélité & Conversion de Points", styles['SectionTitle']))
    story.append(Paragraph(
        "Chaque opération réalisée sur la plateforme génère des points Mongain (MP) accumulés dans le profil usager. "
        "Ces points sont convertibles à tout moment en liquidités réelles selon un taux garanti de <b>10 MP = 1 FCFA</b>, "
        "tout en servant d'assise de collatéral virtuel pour débloquer les plafonds de micro-crédits.",
        styles['Body']
    ))

    # --- 3.13 FAMILLE ---
    story.append(Paragraph("3.13 Supervision Parentale & Comptes Famille", styles['SectionTitle']))
    story.append(Paragraph(
        "Permet aux chefs de famille d'éduquer financièrement leurs enfants en toute sécurité : "
        "le parent génère un sous-compte <code>CHILD</code> rattaché à son profil, module les plafonds journaliers à sa convenance, "
        "et reçoit une notification d'audit push immédiate à la moindre dépense effectuée par l'enfant.",
        styles['Body']
    ))

    # --- 3.14 CARTES ---
    story.append(Paragraph("3.14 Cartes Bancaires Virtuelles", styles['SectionTitle']))
    story.append(Paragraph(
        "Interface de gestion de cartes de paiement prépayées dématérialisées. Sécurisée par la variable <code>ENABLE_UNVERIFIED_CARDS</code> "
        "empêchant toute émission factice en environnement de production réelle sans raccordement à un processeur certifié PCI-DSS.",
        styles['Body']
    ))

    # --- 3.15 STAKING ---
    story.append(Paragraph("3.15 Comptes à Terme Rémunérés (Staking Vaults)", styles['SectionTitle']))
    story.append(Paragraph(
        "Produit d'épargne bloquée à terme : dépôt initial d'un seuil minimum de 10 000 FCFA avec horizon d'engagement "
        "de 1 à 60 mois. Rémunération adossée à un taux de rendement annuel garanti de 5% (APY base).",
        styles['Body']
    ))

    # --- 3.16 USSD ---
    story.append(Paragraph("3.16 Passerelle Téléphonique USSD & Inclusivité", styles['SectionTitle']))
    story.append(Paragraph(
        "Afin de ne laisser aucun citoyen en marge en zone rurale ou sans smartphone, Mongain intègre une passerelle standardisée "
        "USSD (<code>POST /api/ussd/gateway</code>). Elle permet la consultation de solde et l'envoi de fonds par code court GSM "
        "sécurisé par clé partagée <code>USSD_GATEWAY_SECRET</code> avec les opérateurs Airtel et Moov.",
        styles['Body']
    ))

    story.append(PageBreak())

    # =========================================================================
    # CHAPITRE 4 : LE PORTAIL DES GRANDS MARCHANDS
    # =========================================================================
    story.append(Paragraph("CHAPITRE 4", styles['ChapterNumber']))
    story.append(Paragraph("Le Portail des Grands Marchands", styles['ChapterTitle']))
    story.append(HRFlowable(width="100%", thickness=1.5, color=COLOR_ACCENT, spaceBefore=2, spaceAfter=10))

    story.append(Paragraph(
        "Le Portail Grand Marchand (hébergé sur le port 5174) est une application web dédiée aux entités professionnelles "
        "et institutionnelles détenant le statut <code>merchantTier = 'GIANT'</code>. Elle permet de superviser des écosystèmes "
        "commerciaux complexes tels que les régies municipales de marchés, les coopératives agricoles ou les distributeurs à réseau.",
        styles['Body']
    ))

    story.append(Paragraph("4.1 Isolation Absolue des Sessions", styles['SectionTitle']))
    story.append(Paragraph(
        "Un dirigeant d'entreprise peut utiliser simultanément son application mobile pour ses dépenses personnelles et la console "
        "web pour sa trésorerie d'entreprise. Les tokens d'authentification du portail marchand sont signés spécifiquement avec "
        "les champs <code>portalTokenVersion</code> et <code>portalRefreshTokenHash</code>, empêchant tout télescopage avec le cycle de vie "
        "de l'APK mobile.",
        styles['Body']
    ))

    story.append(Paragraph("4.2 Architecture des Affiliations & Prélèvement Automatisé", styles['SectionTitle']))
    story.append(Paragraph(
        "Le mécanisme d'affiliation régit la relation contractuelle entre le Grand Marchand (ex: la Mairie de Libreville) et "
        "les Petits Marchands (ex: les commerçants du marché Mont-Bouët) :<br/>"
        "• <b>Établissement du Lien :</b> Le grand marchand saisit le numéro de téléphone de l'affilié, la périodicité de paiement (HEBDOMADAIRE ou MENSUELLE) "
        "et le montant de la redevance exigible en FCFA.<br/>"
        "• <b>Option Auto-Pay (Prélèvement Automatique) :</b> Si cette option est active (<code>autoPayEnabled = true</code>), l'automate nocturne CRON "
        "débite directement le compte du petit marchand à l'échéance et crédite le wallet commission du Grand Marchand.<br/>"
        "• <b>Matrice de Conformité :</b> Le tableau de bord affiche un code couleur immédiat pour chaque commerçant : "
        "vert si les paiements sont honorés, rouge avec mention 'En retard' dès que la date <code>nextPaymentDue</code> est dépassée.",
        styles['Body']
    ))

    story.append(Paragraph("4.3 Modules d'Exploitation Entreprise", styles['SectionTitle']))

    giant_modules_data = [
        [Paragraph("Module", styles['TableHead']), Paragraph("Fonctionnalités Clés", styles['TableHead'])],
        [
            Paragraph("Tableau de Bord & KPIs", styles['TableCellBold']),
            Paragraph("Revenus consolidés jour/semaine/mois, ventilation des soldes de vente vs commissions perçues, graphiques de volumétrie.", styles['TableCell'])
        ],
        [
            Paragraph("Rapports & Audit", styles['TableCellBold']),
            Paragraph("Filtrage fin des encaissements par caisse, export de journaux financiers, analyse comparative des rendements par période.", styles['TableCell'])
        ],
        [
            Paragraph("Payroll Salariés de Masse", styles['TableCellBold']),
            Paragraph("Rémunération groupée des collaborateurs par importation de fichier CSV ou saisie de grille unifiée, exécutée en batch transactionnel.", styles['TableCell'])
        ],
        [
            Paragraph("Gestion des Guichets (Tills)", styles['TableCellBold']),
            Paragraph("Création, suivi d'activité et désactivation de points d'encaissement déportés avec identifiants restreints pour caissiers.", styles['TableCell'])
        ],
        [
            Paragraph("Gestion de l'Équipe Portail", styles['TableCellBold']),
            Paragraph("Attribution de rôles internes au sein de l'entreprise : <b>OWNER</b> (direction), <b>MANAGER</b> (supervision), <b>CASHIER</b> (encaissement) et <b>AUDITOR</b> (lecture seule).", styles['TableCell'])
        ],
        [
            Paragraph("Demandes de Retrait Agence", styles['TableCellBold']),
            Paragraph("Émission d'ordres de déchargement de fonds du wallet vers les comptes bancaires ou agences physiques partenaires.", styles['TableCell'])
        ]
    ]
    story.append(make_table(giant_modules_data, [45*mm, 130*mm]))

    story.append(PageBreak())

    # =========================================================================
    # CHAPITRE 5 : PORTAIL ADMIN & SUPERVISION CENTRALE
    # =========================================================================
    story.append(Paragraph("CHAPITRE 5", styles['ChapterNumber']))
    story.append(Paragraph("Portail Admin & Supervision Centrale", styles['ChapterTitle']))
    story.append(HRFlowable(width="100%", thickness=1.5, color=COLOR_ACCENT, spaceBefore=2, spaceAfter=10))

    story.append(Paragraph(
        "Le portail d'administration (Admin Web, port 5173) constitue le poste de commandement régalien de Mongain. "
        "Réservé au personnel de l'établissement détenteur de droits RBAC, il structure l'ensemble des opérations "
        "de surveillance et de gouvernance.",
        styles['Body']
    ))

    story.append(Paragraph("5.1 Le Nouveau Dashboard Présidentiel (GiantsOverview)", styles['SectionTitle']))
    story.append(Paragraph(
        "Ce tableau de bord stratégique offre à la Direction Générale et au Président de la plateforme une vision "
        "panoramique instantanée sur l'ensemble de l'économie marchande :",
        styles['Body']
    ))

    admin_kpi_data = [
        [Paragraph("Indicateur Stratégique", styles['TableHead']), Paragraph("Signification Métier", styles['TableHead']), Paragraph("Impact Décisionnel", styles['TableHead'])],
        [
            Paragraph("Volume Global des Géants", styles['TableCellBold']),
            Paragraph("Recensement en temps réel des organisations à statut GIANT en activité.", styles['TableCell']),
            Paragraph("Suivi du maillage institutionnel et partenariats.", styles['TableCell'])
        ],
        [
            Paragraph("Nombre Total d'Affiliés", styles['TableCellBold']),
            Paragraph("Quantité de petits commerçants reliés contractuellement aux grands comptes.", styles['TableCell']),
            Paragraph("Indicateur de capillarité sur le terrain.", styles['TableCell'])
        ],
        [
            Paragraph("Taxes Totales Récoltées", styles['TableCellBold']),
            Paragraph("Cumul historique des redevances prélevées via les flux d'affiliation.", styles['TableCell']),
            Paragraph("Mesure de la valeur générée pour les collectivités.", styles['TableCell'])
        ],
        [
            Paragraph("Taux de Conformité Global", styles['TableCellBold']),
            Paragraph("Ratio des affiliations à jour de cotisation sans retard de paiement.", styles['TableCell']),
            Paragraph("Baromètre de santé financière du secteur informel.", styles['TableCell'])
        ],
        [
            Paragraph("Flux sur 30 Jours", styles['TableCellBold']),
            Paragraph("Dynamique récente des montants collectés et volumétrie d'opérations.", styles['TableCell']),
            Paragraph("Détection précoce des ralentissements économiques.", styles['TableCell'])
        ]
    ]
    story.append(make_table(admin_kpi_data, [45*mm, 65*mm, 65*mm]))

    story.append(Paragraph("5.2 Fiche Client 360° & Lutte Anti-Fraude (AML)", styles['SectionTitle']))
    story.append(Paragraph(
        "L'écran <code>Customer360.tsx</code> centralise l'exhaustivité des données d'un usager : soldes actuels, "
        "historique complet des transactions, documents d'identité téléversés avec zoom haute définition, sessions actives "
        "et journal des actions administratives. Depuis cette interface, le personnel habilité peut :<br/>"
        "• <b>Geler/Dégeler :</b> Bloquer temporairement les mouvements de fonds lors d'un comportement suspect.<br/>"
        "• <b>Signaler (AML Flag) :</b> Marquer un dossier pour blanchiment potentiel ou financement illicite.<br/>"
        "• <b>Réinitialiser les Clés :</b> Forcer la révocation de sessions et le renouvellement de code PIN.<br/>"
        "• <b>Ajuster le Solde :</b> Corriger un solde avec obligation formelle de documenter le motif comptable dans l'AuditLog.",
        styles['Body']
    ))

    story.append(Paragraph("5.3 Trésorerie Centrale & Émission Monétaire (MINT/BURN)", styles['SectionTitle']))
    story.append(Paragraph(
        "La monnaie électronique Mongain en circulation est adossée en permanence à la Réserve de Trésorerie Centrale. "
        "Toute création ou destruction monétaire répond au protocole <b>Maker / Checker</b> :<br/>"
        "• <b>MINT (Création) :</b> Un gestionnaire initie une demande d'injection de liquidités.<br/>"
        "• <b>Double Validation :</b> Un administrateur distinct possédant la permission <code>perm_treasury_approve</code> "
        "doit impérativement viser la requête pour qu'elle devienne exécutoire.<br/>"
        "• <b>BURN (Destruction) :</b> Retrait de monnaie électronique lors des règlements physiques auprès des banques partenaires.",
        styles['Body']
    ))

    story.append(Paragraph("5.4 Terminal Caissier d'Agence (TellerTerminal)", styles['SectionTitle']))
    story.append(Paragraph(
        "Interface de guichet physique permettant au caissier d'ouvrir sa caisse avec un fond d'espèces initial, "
        "de créditer le compte d'un client contre remise de billets (Cash-In), de verser des espèces à un client muni "
        "d'un code de retrait sécurisé (Cash-Out), et d'éditer le bon d'arrêté de caisse journalier réconciliant physique et numérique.",
        styles['Body']
    ))

    story.append(PageBreak())

    # =========================================================================
    # CHAPITRE 6 : MOTEUR CRON & AUTOMATISATIONS D'ARRIERE-PLAN
    # =========================================================================
    story.append(Paragraph("CHAPITRE 6", styles['ChapterNumber']))
    story.append(Paragraph("Moteur CRON & Automatisations d'Arrière-Plan", styles['ChapterTitle']))
    story.append(HRFlowable(width="100%", thickness=1.5, color=COLOR_ACCENT, spaceBefore=2, spaceAfter=10))

    story.append(Paragraph(
        "Le fichier <code>backend/src/cron.ts</code> orchestre 5 processus cycliques fonctionnant en continu "
        "pour maintenir l'intégrité financière sans intervention humaine.",
        styles['Body']
    ))

    cron_data = [
        [Paragraph("Processus Automatisé", styles['TableHead']), Paragraph("Fréquence", styles['TableHead']), Paragraph("Actions Opérées & Logique Métier", styles['TableHead'])],
        [
            Paragraph("executeTontineAutomations", styles['TableCellBold']),
            Paragraph("Quotidien<br/>(24h)", styles['TableCell']),
            Paragraph("Scanne tous les groupes de tontine ACTIVE. Si l'échéance est atteinte, débite la cotisation de chaque membre, transfère la cagnotte intégrale au bénéficiaire du tour, et incrémente le cycle. Tranche automatiquement les scrutins de renouvellement expirés.", styles['TableCell'])
        ],
        [
            Paragraph("checkOverdueLoans", styles['TableCellBold']),
            Paragraph("Quotidien<br/>(24h)", styles['TableCell']),
            Paragraph("Passe au crible tous les micro-crédits arrivés à échéance non soldés. Les bascule irrévocablement au statut DEFAULTED, alerte l'emprunteur par notification/SMS et bloque tout nouvel accès au crédit.", styles['TableCell'])
        ],
        [
            Paragraph("checkOverdueBnpl", styles['TableCellBold']),
            Paragraph("Quotidien<br/>(24h)", styles['TableCell']),
            Paragraph("Vérifie les échéances mensuelles des contrats BNPL. Dès constatation d'un défaut de paiement, déclenche le gel des facilités de crédit et enregistre la créance au contentieux.", styles['TableCell'])
        ],
        [
            Paragraph("executeAutoSettlements", styles['TableCellBold']),
            Paragraph("Quotidien<br/>(24h)", styles['TableCell']),
            Paragraph("Exécute le règlement des compensations et soldes en suspens entre comptes techniques et comptes de règlement partenaires.", styles['TableCell'])
        ],
        [
            Paragraph("executeAffiliationAutoPay", styles['TableCellBold']),
            Paragraph("Quotidien<br/>(24h)", styles['TableCell']),
            Paragraph("Identifie les affiliations de marchands ayant souscrit au prélèvement automatique (autoPayEnabled). Si l'échéance est échue et que le solde est suffisant, prélève la taxe due et la crédite sur le compte du Grand Marchand.", styles['TableCell'])
        ]
    ]
    story.append(make_table(cron_data, [45*mm, 25*mm, 105*mm]))

    story.append(Spacer(1, 8))
    # =========================================================================
    # CHAPITRE 7 : MATRICE DE CYBERSECURITE
    # =========================================================================
    story.append(Paragraph("CHAPITRE 7", styles['ChapterNumber']))
    story.append(Paragraph("Matrice de Cybersécurité & Intégrité Financière", styles['ChapterTitle']))
    story.append(HRFlowable(width="100%", thickness=1.5, color=COLOR_ACCENT, spaceBefore=2, spaceAfter=10))

    security_data = [
        [Paragraph("Dispositif de Sécurité", styles['TableHead']), Paragraph("Mécanisme d'Implémentation Technique", styles['TableHead']), Paragraph("Menace Neutralisée", styles['TableHead'])],
        [
            Paragraph("Chiffrement des Secrets", styles['TableCellBold']),
            Paragraph("Hachage bcryptjs (12 rounds) pour les PINs et mots de passe. SHA-256 pour les tokens de rafraîchissement.", styles['TableCell']),
            Paragraph("Fuite de base de données, usurpation d'identifiants.", styles['TableCell'])
        ],
        [
            Paragraph("Protection Anti-Rejeu", styles['TableCellBold']),
            Paragraph("En-tête d'idempotence UUID (<code>idempotencyKey</code>) validé avant toute exécution de transaction financière.", styles['TableCell']),
            Paragraph("Doubles débits sur micro-coupures réseau ou double clic client.", styles['TableCell'])
        ],
        [
            Paragraph("Transactions ACID Atomiques", styles['TableCellBold']),
            Paragraph("Encapsulation intégrale des mouvements d'argent sous <code>prisma.$transaction()</code> avec rollback automatique.", styles['TableCell']),
            Paragraph("Création monétaire orpheline, déséquilibre comptable.", styles['TableCell'])
        ],
        [
            Paragraph("Rate Limiting Avancé", styles['TableCellBold']),
            Paragraph("express-rate-limit indexé par identifiant de compte pour les flux financiers et par IP/numéro pour l'émission d'OTPs.", styles['TableCell']),
            Paragraph("Attaques DDoS, force brute de PIN, fraude au SMS pumping.", styles['TableCell'])
        ],
        [
            Paragraph("Contrôle d'Origine CORS & IP", styles['TableCellBold']),
            Paragraph("Whitelist stricte des domaines web autorisés et vérification IP allowlist sur les routes <code>/api/admin/*</code>.", styles['TableCell']),
            Paragraph("Cross-Site Scripting (XSS), intrusion non autorisée sur l'admin.", styles['TableCell'])
        ],
        [
            Paragraph("Isolation des Canaux", styles['TableCellBold']),
            Paragraph("Tokens étanches entre Mobile (jwtVersion), Marchand (portalTokenVersion) et Staff corporate.", styles['TableCell']),
            Paragraph("Élévation de privilèges transverses.", styles['TableCell'])
        ]
    ]
    story.append(make_table(security_data, [40*mm, 75*mm, 60*mm]))

    story.append(PageBreak())

    # =========================================================================
    # CHAPITRE 8 : ECOSYSTEME D'INTEGRATIONS & INFRASTRUCTURE CLOUD
    # =========================================================================
    story.append(Paragraph("CHAPITRE 8", styles['ChapterNumber']))
    story.append(Paragraph("Écosystème d'Intégrations & Infrastructure Cloud", styles['ChapterTitle']))
    story.append(HRFlowable(width="100%", thickness=1.5, color=COLOR_ACCENT, spaceBefore=2, spaceAfter=10))

    partner_data = [
        [Paragraph("Partenaire / Service", styles['TableHead']), Paragraph("Type d'Intégration", styles['TableHead']), Paragraph("Statut", styles['TableHead']), Paragraph("Détail Technique & Utilisation", styles['TableHead'])],
        [
            Paragraph("PVit Payment Gateway", styles['TableCellBold']),
            Paragraph("API REST / Webhooks", styles['TableCell']),
            Paragraph("ACTIF", styles['TableCellBold']),
            Paragraph("Agrégateur Mobile Money permettant d'injecter des fonds (Cash-In) et de décaisser vers les réseaux Airtel Money et Moov Africa Gabon.", styles['TableCell'])
        ],
        [
            Paragraph("Expo Push Server", styles['TableCellBold']),
            Paragraph("FCM / APNs Relay", styles['TableCell']),
            Paragraph("ACTIF", styles['TableCellBold']),
            Paragraph("Transmission instantanée des notifications de débits, crédits et alertes système sur les terminaux Android et iOS (canal 'transactions-v2').", styles['TableCell'])
        ],
        [
            Paragraph("Passerelle SMS Nationale", styles['TableCellBold']),
            Paragraph("Passerelle Télécom", styles['TableCell']),
            Paragraph("ACTIF", styles['TableCellBold']),
            Paragraph("Distribution des codes de validation OTP à 4 chiffres lors des phases d'authentification et de confirmation d'opérations sensibles.", styles['TableCell'])
        ],
        [
            Paragraph("Neon Cloud Database", styles['TableCellBold']),
            Paragraph("PostgreSQL Serverless", styles['TableCell']),
            Paragraph("ACTIF", styles['TableCellBold']),
            Paragraph("Base de données managée hautement disponible, intégrant mise à l'échelle automatique et sauvegardes instantanées en continu.", styles['TableCell'])
        ],
        [
            Paragraph("Passerelle USSD Telco", styles['TableCellBold']),
            Paragraph("Protocole GSM / SS7", styles['TableCell']),
            Paragraph("PRET", styles['TableCellBold']),
            Paragraph("Contrôleur de routage session USSD compatible avec les standards d'Africa's Talking et des opérateurs cellulaires locaux.", styles['TableCell'])
        ]
    ]
    story.append(make_table(partner_data, [35*mm, 35*mm, 20*mm, 85*mm]))

    story.append(Spacer(1, 8))
    # =========================================================================
    # CHAPITRE 9 : SCHEMA RELATIONNEL DE LA BASE DE DONNEES
    # =========================================================================
    story.append(Paragraph("CHAPITRE 9", styles['ChapterNumber']))
    story.append(Paragraph("Schéma Relationnel de la Base de Données", styles['ChapterTitle']))
    story.append(HRFlowable(width="100%", thickness=1.5, color=COLOR_ACCENT, spaceBefore=2, spaceAfter=10))

    story.append(Paragraph(
        "Le modèle de données défini sous Prisma compile plus de 30 entités interconnectées, "
        "garantissant l'intégrité référentielle par clés étrangères explicites :",
        styles['Body']
    ))

    schema_data = [
        [Paragraph("Entité Prisma", styles['TableHead']), Paragraph("Champs Essentiels", styles['TableHead']), Paragraph("Relations & Rôle Fonctionnel", styles['TableHead'])],
        [
            Paragraph("User", styles['TableCellBold']),
            Paragraph("id, phone, name, pin, role, merchantTier, kycLevel, loyaltyPoints, accountStatus", styles['TableCellCode']),
            Paragraph("Entité centrale. Possède un Wallet, un CommissionWallet, des affiliations, prêts, et tontines.", styles['TableCell'])
        ],
        [
            Paragraph("Staff", styles['TableCellBold']),
            Paragraph("id, email, name, password, role, isActive, permissions, branchId", styles['TableCellCode']),
            Paragraph("Collaborateurs Mongain. Rattaché optionnellement à une succursale (Branch).", styles['TableCell'])
        ],
        [
            Paragraph("Wallet", styles['TableCellBold']),
            Paragraph("id, userId, balance (Int)", styles['TableCellCode']),
            Paragraph("Portefeuille principal en FCFA d'un User ou d'un compte système (CORPORATE, RESERVE).", styles['TableCell'])
        ],
        [
            Paragraph("Transaction", styles['TableCellBold']),
            Paragraph("id, amount, status, reference, senderWalletId, receiverWalletId", styles['TableCellCode']),
            Paragraph("Ligne immuable du grand livre reliant deux portefeuilles avec montant en FCFA entier.", styles['TableCell'])
        ],
        [
            Paragraph("MerchantAffiliation", styles['TableCellBold']),
            Paragraph("id, giantId, merchantId, status, expectedAmount, expectedFrequency, autoPayEnabled", styles['TableCellCode']),
            Paragraph("Contrat liant un petit commerçant à un Grand Marchand pour la collecte de taxes.", styles['TableCell'])
        ],
        [
            Paragraph("TontineGroup", styles['TableCellBold']),
            Paragraph("id, name, contribution, frequency, status, creatorId, renewalDeadline", styles['TableCellCode']),
            Paragraph("Groupe d'épargne collective. Contient des TontineParticipant et des TontineCycle.", styles['TableCell'])
        ],
        [
            Paragraph("Vault", styles['TableCellBold']),
            Paragraph("id, name, targetAmount, balance, pinHash, creatorId", styles['TableCellCode']),
            Paragraph("Caisse commune collaborative avec membres (VaultMember) et demandes de retrait.", styles['TableCell'])
        ],
        [
            Paragraph("Loan", styles['TableCellBold']),
            Paragraph("id, userId, amount, termDays, status (ACTIVE/REPAID/DEFAULTED), dueDate", styles['TableCellCode']),
            Paragraph("Micro-crédit alloué avec suivi des pénalités d'impayé.", styles['TableCell'])
        ]
    ]
    story.append(make_table(schema_data, [35*mm, 65*mm, 75*mm]))

    story.append(PageBreak())

    # =========================================================================
    # CHAPITRE 10 : DICTIONNAIRE DETAILLE DES INTERFACES D'API REST
    # =========================================================================
    story.append(Paragraph("CHAPITRE 10", styles['ChapterNumber']))
    story.append(Paragraph("Dictionnaire Détaillé des Interfaces d'API REST", styles['ChapterTitle']))
    story.append(HRFlowable(width="100%", thickness=1.5, color=COLOR_ACCENT, spaceBefore=2, spaceAfter=10))

    story.append(Paragraph(
        "Inventaire exhaustif des principaux points d'accès classés par contrôleur métier. "
        "Tous les endpoints nécessitent un jeton JWT Bearer, sauf indication contraire.",
        styles['Body']
    ))

    api_data = [
        [Paragraph("Méthode", styles['TableHead']), Paragraph("Point de Terminaison (Endpoint)", styles['TableHead']), Paragraph("Description & Rôle Métier", styles['TableHead'])],
        # Auth
        [Paragraph("POST", styles['TableCellBold']), Paragraph("/api/auth/request-otp", styles['TableCellCode']), Paragraph("Émission d'un code OTP par SMS pour vérification de ligne.", styles['TableCell'])],
        [Paragraph("POST", styles['TableCellBold']), Paragraph("/api/auth/register", styles['TableCellCode']), Paragraph("Enrôlement final d'un usager avec PIN et nom d'utilisateur.", styles['TableCell'])],
        [Paragraph("POST", styles['TableCellBold']), Paragraph("/api/auth/login", styles['TableCellCode']), Paragraph("Authentification par numéro et PIN secret.", styles['TableCell'])],
        [Paragraph("POST", styles['TableCellBold']), Paragraph("/api/auth/verify-login-otp", styles['TableCellCode']), Paragraph("Validation du second facteur 2FA par SMS pour émission de tokens.", styles['TableCell'])],
        [Paragraph("POST", styles['TableCellBold']), Paragraph("/api/auth/refresh", styles['TableCellCode']), Paragraph("Renouvellement transparent de l'access token via refresh token.", styles['TableCell'])],
        [Paragraph("GET", styles['TableCellBold']), Paragraph("/api/auth/me", styles['TableCellCode']), Paragraph("Extraction du profil complet de l'utilisateur connecté.", styles['TableCell'])],
        [Paragraph("POST", styles['TableCellBold']), Paragraph("/api/auth/kyc", styles['TableCellCode']), Paragraph("Transmission des clichés de pièces d'identité pour certification.", styles['TableCell'])],
        # Wallet
        [Paragraph("GET", styles['TableCellBold']), Paragraph("/api/wallet/balance", styles['TableCellCode']), Paragraph("Lecture en temps réel du solde disponible du portefeuille.", styles['TableCell'])],
        [Paragraph("GET", styles['TableCellBold']), Paragraph("/api/wallet/transactions", styles['TableCellCode']), Paragraph("Historique exhaustif et paginé des opérations du compte.", styles['TableCell'])],
        [Paragraph("GET", styles['TableCellBold']), Paragraph("/api/wallet/limits", styles['TableCellCode']), Paragraph("Consultation des plafonds disponibles (journaliers, mensuels).", styles['TableCell'])],
        [Paragraph("POST", styles['TableCellBold']), Paragraph("/api/wallet/transfer", styles['TableCellCode']), Paragraph("Virement P2P instantané vers un autre usager avec confirmation PIN.", styles['TableCell'])],
        [Paragraph("POST", styles['TableCellBold']), Paragraph("/api/wallet/generate-withdraw-code", styles['TableCellCode']), Paragraph("Génération d'un code OTP de retrait d'espèces en agence.", styles['TableCell'])],
        [Paragraph("POST", styles['TableCellBold']), Paragraph("/api/wallet/client-initiated-withdraw", styles['TableCellCode']), Paragraph("Retrait de fonds direct vers compte Mobile Money (Airtel/Moov).", styles['TableCell'])],
        [Paragraph("POST", styles['TableCellBold']), Paragraph("/api/wallet/qr-scan", styles['TableCellCode']), Paragraph("Encaissement marchand par scan de QR code client.", styles['TableCell'])],
        # Tontines
        [Paragraph("POST", styles['TableCellBold']), Paragraph("/api/tontine/create", styles['TableCellCode']), Paragraph("Création d'un club de tontine avec montant et cadence de cycle.", styles['TableCell'])],
        [Paragraph("GET", styles['TableCellBold']), Paragraph("/api/tontine/groups", styles['TableCellCode']), Paragraph("Liste des tontines auxquelles participe l'utilisateur.", styles['TableCell'])],
        [Paragraph("POST", styles['TableCellBold']), Paragraph("/api/tontine/join", styles['TableCellCode']), Paragraph("Adhésion à un groupe de tontine ouvert ou sur invitation.", styles['TableCell'])],
        [Paragraph("POST", styles['TableCellBold']), Paragraph("/api/tontine/contribute", styles['TableCellCode']), Paragraph("Cotisation anticipée avant la date d'échéance du cycle.", styles['TableCell'])],
        [Paragraph("POST", styles['TableCellBold']), Paragraph("/api/tontine/renewal-vote", styles['TableCellCode']), Paragraph("Vote pour la reconduction ou la clôture d'une tontine achevée.", styles['TableCell'])],
        # Vaults
        [Paragraph("GET", styles['TableCellBold']), Paragraph("/api/vault", styles['TableCellCode']), Paragraph("Consultation des caisses communes dont l'usager est membre.", styles['TableCell'])],
        [Paragraph("POST", styles['TableCellBold']), Paragraph("/api/vault", styles['TableCellCode']), Paragraph("Initialisation d'une nouvelle caisse d'épargne d'objectif.", styles['TableCell'])],
        [Paragraph("POST", styles['TableCellBold']), Paragraph("/api/vault/:id/deposit", styles['TableCellCode']), Paragraph("Versement de liquidités dans une caisse commune.", styles['TableCell'])],
        [Paragraph("POST", styles['TableCellBold']), Paragraph("/api/vault/:id/withdraw-request", styles['TableCellCode']), Paragraph("Soumission d'une demande de retrait soumise à approbation.", styles['TableCell'])],
        # Crédit & BNPL
        [Paragraph("GET", styles['TableCellBold']), Paragraph("/api/credit/eligibility", styles['TableCellCode']), Paragraph("Évaluation de solvabilité et calcul du montant de crédit autorisé.", styles['TableCell'])],
        [Paragraph("POST", styles['TableCellBold']), Paragraph("/api/credit/apply", styles['TableCellCode']), Paragraph("Déblocage immédiat d'un micro-crédit sur le wallet de l'emprunteur.", styles['TableCell'])],
        [Paragraph("POST", styles['TableCellBold']), Paragraph("/api/credit/repay", styles['TableCellCode']), Paragraph("Remboursement total ou partiel de la créance en cours.", styles['TableCell'])],
        [Paragraph("POST", styles['TableCellBold']), Paragraph("/api/bnpl/apply", styles['TableCellCode']), Paragraph("Souscription d'une facilité de paiement différé à 5% de frais.", styles['TableCell'])],
        # Portail Marchand
        [Paragraph("POST", styles['TableCellBold']), Paragraph("/api/merchant-portal/auth/login", styles['TableCellCode']), Paragraph("Connexion téléphonique au portail web Grand Marchand.", styles['TableCell'])],
        [Paragraph("GET", styles['TableCellBold']), Paragraph("/api/merchant-portal/dashboard", styles['TableCellCode']), Paragraph("Statistiques de revenus, soldes et volumétrie d'encaissement.", styles['TableCell'])],
        [Paragraph("POST", styles['TableCellBold']), Paragraph("/api/merchant-portal/affiliations", styles['TableCellCode']), Paragraph("Création d'une affiliation d'un commerçant avec termes de taxe.", styles['TableCell'])],
        [Paragraph("PATCH", styles['TableCellBold']), Paragraph("/api/merchant-portal/affiliations/:id/terms", styles['TableCellCode']), Paragraph("Ajustement des redevances et activation du prélèvement auto.", styles['TableCell'])],
        [Paragraph("POST", styles['TableCellBold']), Paragraph("/api/merchant-portal/payroll/bulk", styles['TableCellCode']), Paragraph("Virement salarial de masse par téléversement de fichier.", styles['TableCell'])],
        # Admin
        [Paragraph("GET", styles['TableCellBold']), Paragraph("/api/admin/stats", styles['TableCellCode']), Paragraph("KPIs macroscopiques généraux de la plateforme Mongain.", styles['TableCell'])],
        [Paragraph("GET", styles['TableCellBold']), Paragraph("/api/admin/giants/overview", styles['TableCellCode']), Paragraph("Dashboard présidentiel : récoltes des géants, conformité.", styles['TableCell'])],
        [Paragraph("GET", styles['TableCellBold']), Paragraph("/api/admin/giants", styles['TableCellCode']), Paragraph("Inventaire exhaustif de tous les grands marchands institutionnels.", styles['TableCell'])],
        [Paragraph("GET", styles['TableCellBold']), Paragraph("/api/admin/giants/:id", styles['TableCellCode']), Paragraph("Détail d'un géant, liste de ses commerçants et flux perçus.", styles['TableCell'])],
        [Paragraph("GET", styles['TableCellBold']), Paragraph("/api/admin/merchants", styles['TableCellCode']), Paragraph("Liste de l'ensemble des commerçants de détail de la plateforme.", styles['TableCell'])],
        [Paragraph("POST", styles['TableCellBold']), Paragraph("/api/admin/merchants/:id/payouts/:pid/approve", styles['TableCellCode']), Paragraph("Approbation et compensation financière d'un retrait marchand.", styles['TableCell'])],
    ]
    story.append(make_table(api_data, [20*mm, 65*mm, 90*mm]))

    story.append(PageBreak())

    # =========================================================================
    # CHAPITRE 11 : MANUEL DE DEPLOIEMENT & EXPLOITATION
    # =========================================================================
    story.append(Paragraph("CHAPITRE 11", styles['ChapterNumber']))
    story.append(Paragraph("Manuel de Déploiement & Exploitation", styles['ChapterTitle']))
    story.append(HRFlowable(width="100%", thickness=1.5, color=COLOR_ACCENT, spaceBefore=2, spaceAfter=10))

    story.append(Paragraph("11.1 Guide de Démarrage en Environnement Local", styles['SectionTitle']))
    story.append(Paragraph(
        "Pour initialiser l'ensemble des modules sur un poste de développement ou une machine de démonstration :",
        styles['Body']
    ))

    story.append(Paragraph(
        "<b>Script d'exécution rapide (Portail Marchand + Backend) :</b><br/>"
        "Exécuter <code>lancer_portail_marchand.bat</code> à la racine du projet. Ce script démarre le moteur backend "
        "sur le port 3000 et le portail web des grands marchands sur le port 5174.<br/><br/>"
        "<b>Script d'orchestration totale (4 Serveurs) :</b><br/>"
        "Exécuter <code>demarrer_serveurs.bat</code> pour instancier simultanément le Backend (3000), "
        "l'Admin Web (5173), le Portail Marchand (5174) et le serveur Expo bundler pour mobile.",
        styles['Body']
    ))

    story.append(Paragraph("11.2 Création Sécurisée du Compte Président (Super Admin)", styles['SectionTitle']))
    story.append(Paragraph(
        "Pour créer un compte à privilèges absolus pour la Direction Générale, exécuter le script suivant dans le répertoire <code>backend/</code> :",
        styles['Body']
    ))

    code_script = (
        "const bcrypt = require('bcryptjs');\n"
        "const { PrismaClient } = require('@prisma/client');\n"
        "const prisma = new PrismaClient();\n\n"
        "async function initPresident() {\n"
        "  const hash = await bcrypt.hash('Mongain2024!', 12);\n"
        "  const president = await prisma.staff.create({\n"
        "    data: {\n"
        "      name: 'Président Mongain',\n"
        "      email: 'president@mongain.com',\n"
        "      role: 'SUPER_ADMIN',\n"
        "      password: hash,\n"
        "      isActive: true,\n"
        "      mustChangePassword: false,\n"
        "    }\n"
        "  });\n"
        "  console.log('Compte Président initialisé avec succès :', president.email);\n"
        "}\n"
        "initPresident().finally(() => prisma.$disconnect());"
    )
    story.append(Paragraph(code_script.replace('\n', '<br/>').replace(' ', '&nbsp;'), styles['CodeSnippet']))

    story.append(Paragraph("11.3 Gestion & Synchronisation de la Base de Données", styles['SectionTitle']))
    story.append(Paragraph(
        "La base de données Neon PostgreSQL est mise à jour avec Prisma :<br/>"
        "• Pour appliquer les évolutions de schéma : exécuter <code>maj_bdd.bat</code> ou la commande <code>npx prisma db push</code> dans <code>backend/</code>.<br/>"
        "• Pour inspecter visuellement les enregistrements et réaliser des requêtes manuelles : <code>npx prisma studio</code> (interface accessible sur port 5555).",
        styles['Body']
    ))

    story.append(Paragraph("11.4 Pipeline de Déploiement en Production Cloud", styles['SectionTitle']))
    story.append(Paragraph(
        "Le déploiement en production est automatisé (CI/CD) sur la plateforme Cloud <b>Render.com</b> :<br/>"
        "1. Tout commit synchronisé sur le dépôt Git principal déclenche un build automatique configuré via <code>render.yaml</code>.<br/>"
        "2. Render installe les dépendances, compile le code TypeScript et redémarre le conteneur Node.js sans interruption de service.<br/>"
        "3. L'application mobile compilée (APK EAS) pointe vers <code>https://mongain-backend.onrender.com</code>, assurant une disponibilité permanente pour les usagers.",
        styles['Body']
    ))

    story.append(PageBreak())

    # =========================================================================
    # CHAPITRE 12 : GLOSSAIRE TERMINOLOGIQUE & CONCEPTS METIERS FINTECH
    # =========================================================================
    story.append(Paragraph("CHAPITRE 12", styles['ChapterNumber']))
    story.append(Paragraph("Glossaire Terminologique & Concepts Métiers", styles['ChapterTitle']))
    story.append(HRFlowable(width="100%", thickness=1.5, color=COLOR_ACCENT, spaceBefore=2, spaceAfter=10))

    story.append(Paragraph(
        "Ce glossaire fixe la terminologie officielle utilisée dans le code source, les documentations d'API, "
        "les schémas de données et les procédures d'audit financier de Mongain.",
        styles['Body']
    ))

    glossary_data = [
        [Paragraph("Terme Métier / Code", styles['TableHead']), Paragraph("Domaine", styles['TableHead']), Paragraph("Définition & Implémentation Système", styles['TableHead'])],
        [
            Paragraph("FCFA (XAF)", styles['TableCellBold']),
            Paragraph("Devise", styles['TableCell']),
            Paragraph("Franc de la Coopération Financière en Afrique Centrale (BEAC). Devise légale de base. Typée strictement en entiers relatifs (Int) sans décimale dans toute la base de données.", styles['TableCell'])
        ],
        [
            Paragraph("LimitEngine", styles['TableCellBold']),
            Paragraph("Contrôle Risque", styles['TableCell']),
            Paragraph("Moteur prudentiel vérifiant en amont de chaque transaction les plafonds unitaires, journaliers (24h glissantes) et mensuels (30 jours) selon le niveau KYC.", styles['TableCell'])
        ],
        [
            Paragraph("Tontine Rotative", styles['TableCellBold']),
            Paragraph("Épargne", styles['TableCell']),
            Paragraph("Club financier où chaque participant verse une mise périodique fixe et reçoit la cagnotte intégrale à son rang de tour (payoutOrder), renouvelable par scrutin collégial.", styles['TableCell'])
        ],
        [
            Paragraph("Caisse Commune (Vault)", styles['TableCellBold']),
            Paragraph("Épargne", styles['TableCell']),
            Paragraph("Compte d'épargne collectif bloqué dédié à un objectif commun, dont les décaissements exigent un vote d'approbation majoritaire des membres habilités.", styles['TableCell'])
        ],
        [
            Paragraph("Principe Maker / Checker", styles['TableCellBold']),
            Paragraph("Gouvernance", styles['TableCell']),
            Paragraph("Règle de contrôle interne imposant que toute action financière sensible (MINT de réserve, modification des taux système) soit initiée par un agent et visée par un second agent distinct.", styles['TableCell'])
        ],
        [
            Paragraph("Staking Vault", styles['TableCellBold']),
            Paragraph("Investissement", styles['TableCell']),
            Paragraph("Contrat de placement à terme bloquant des liquidités de 1 à 60 mois contre une rémunération d'intérêts annuelle garantie fixée à 5% d'APY de base.", styles['TableCell'])
        ],
        [
            Paragraph("BNPL (Buy Now Pay Later)", styles['TableCellBold']),
            Paragraph("Crédit", styles['TableCell']),
            Paragraph("Paiement échelonné d'achats marchands jusqu'à 50 000 FCFA amorti sur plusieurs mois avec un taux forfaitaire de 5% et blocage automatique en cas d'impayé.", styles['TableCell'])
        ],
        [
            Paragraph("Clé d'Idempotence", styles['TableCellBold']),
            Paragraph("Cybersécurité", styles['TableCell']),
            Paragraph("Jeton UUID unique transmis par le terminal client évitant d'exécuter deux fois le même débit lors d'un double-clic ou d'une reconnexion après coupure réseau.", styles['TableCell'])
        ],
        [
            Paragraph("Passerelle PVit", styles['TableCellBold']),
            Paragraph("Paiement Télécom", styles['TableCell']),
            Paragraph("Agrégateur certifié effectuant les liaisons d'interopérabilité entre les portefeuilles Mongain et les comptes Airtel Money / Moov Africa.", styles['TableCell'])
        ],
        [
            Paragraph("Passerelle USSD", styles['TableCellBold']),
            Paragraph("Inclusion GSM", styles['TableCell']),
            Paragraph("Interface de dialogue temps réel sur réseau cellulaire 2G permettant l'accès sans Internet via un code court (*...#) sécurisé par secret partagé.", styles['TableCell'])
        ],
        [
            Paragraph("KYC (Know Your Customer)", styles['TableCellBold']),
            Paragraph("Conformité", styles['TableCell']),
            Paragraph("Graduation de certification d'identité en 3 échelons (0, 1, 2) conditionnant le volume maximal de liquidités pouvant transiter sur un compte.", styles['TableCell'])
        ],
        [
            Paragraph("AML / LCB-FT", styles['TableCellBold']),
            Paragraph("Conformité", styles['TableCell']),
            Paragraph("Dispositif légal de surveillance des flux atypiques, signalement d'opérations de blanchiment et blocage conservatoire des avoirs criminels.", styles['TableCell'])
        ],
        [
            Paragraph("MerchantTier GIANT", styles['TableCellBold']),
            Paragraph("Marchands", styles['TableCell']),
            Paragraph("Accréditation accordée aux institutions et grands comptes déverrouillant le portail web dédié (5174), les affiliations et le prélèvement de taxes.", styles['TableCell'])
        ],
        [
            Paragraph("Auto-Pay Affiliation", styles['TableCellBold']),
            Paragraph("Automatisme", styles['TableCell']),
            Paragraph("Prélèvement automatique journalier exécuté par robot CRON collectant les taxes de place de marché sur le compte des petits commerçants affiliés.", styles['TableCell'])
        ],
        [
            Paragraph("MINT / BURN", styles['TableCellBold']),
            Paragraph("Trésorerie", styles['TableCell']),
            Paragraph("Mécanisme d'émission (MINT) et d'absorption (BURN) de monnaie électronique en partie double rigoureusement adossé aux avoirs en banque centrale.", styles['TableCell'])
        ],
        [
            Paragraph("Session Isolation", styles['TableCellBold']),
            Paragraph("Architecture", styles['TableCell']),
            Paragraph("Cloisonnement cryptographique interdisant l'utilisation d'un jeton d'accès d'un sous-système (Mobile, Marchand, Staff) sur un autre sous-système.", styles['TableCell'])
        ]
    ]
    story.append(make_table(glossary_data, [45*mm, 35*mm, 95*mm]))

    story.append(PageBreak())

    # =========================================================================
    # CHAPITRE 13 : REFERENTIEL DES CODES D'ERREUR & DEPANNAGE P0
    # =========================================================================
    story.append(Paragraph("CHAPITRE 13", styles['ChapterNumber']))
    story.append(Paragraph("Référentiel des Codes d'Erreur & Dépannage P0", styles['ChapterTitle']))
    story.append(HRFlowable(width="100%", thickness=1.5, color=COLOR_ACCENT, spaceBefore=2, spaceAfter=10))

    story.append(Paragraph(
        "Ce chapitre fournit la grille de diagnostic des statuts d'erreur HTTP émis par le backend ainsi que le "
        "protocole de rétablissement prioritaire pour les incidents de criticité P0 (blocage opérationnel).",
        styles['Body']
    ))

    story.append(Paragraph("13.1 Matrice des Codes d'Erreur HTTP de l'API", styles['SectionTitle']))

    error_data = [
        [Paragraph("Code HTTP", styles['TableHead']), Paragraph("Motif Fréquent & Signification", styles['TableHead']), Paragraph("Impact Client", styles['TableHead']), Paragraph("Procédure de Rétablissement", styles['TableHead'])],
        [
            Paragraph("400 Bad Request", styles['TableCellBold']),
            Paragraph("PIN erroné, montant négatif ou non entier, code QR invalide, schéma Zod non respecté.", styles['TableCell']),
            Paragraph("Opération bloquée immédiatement.", styles['TableCell']),
            Paragraph("Vérifier la saisie du PIN, s'assurer que les montants sont sans virgule.", styles['TableCell'])
        ],
        [
            Paragraph("401 Unauthorized", styles['TableCellBold']),
            Paragraph("Access Token JWT expiré (TTL 15 min), absent ou signature altérée.", styles['TableCell']),
            Paragraph("Écran de reconnexion ou session expirée.", styles['TableCell']),
            Paragraph("Appeler <code>POST /api/auth/refresh</code> avec le refresh token stocké.", styles['TableCell'])
        ],
        [
            Paragraph("403 Forbidden", styles['TableCellBold']),
            Paragraph("Compte gelé (FROZEN), compte bloqué, permission RBAC manquante, accès enfant restreint.", styles['TableCell']),
            Paragraph("Accès refusé au service demandé.", styles['TableCell']),
            Paragraph("Contrôler le statut dans Customer 360°, dégeler le compte si justifié.", styles['TableCell'])
        ],
        [
            Paragraph("404 Not Found", styles['TableCellBold']),
            Paragraph("Utilisateur destinataire inexistant, contrat de prêt ou tontine introuvable.", styles['TableCell']),
            Paragraph("Message 'Bénéficiaire introuvable'.", styles['TableCell']),
            Paragraph("Vérifier la numérotation téléphonique normalisée (+241...).", styles['TableCell'])
        ],
        [
            Paragraph("429 Too Many Req.", styles['TableCellBold']),
            Paragraph("Dépassement du quota de SMS (5/h), bruteforce PIN (3 échecs), suractivité financière.", styles['TableCell']),
            Paragraph("Verrouillage temporaire de 15 minutes.", styles['TableCell']),
            Paragraph("Patienter jusqu'à l'expiration de la fenêtre de 15 min ou déverrouiller via admin.", styles['TableCell'])
        ],
        [
            Paragraph("501 Not Implemented", styles['TableCellBold']),
            Paragraph("Fonctionnalité désactivée (Cartes virtuelles non connectées, SEEG/Canal non raccordés).", styles['TableCell']),
            Paragraph("Notification 'Service en cours de raccordement'.", styles['TableCell']),
            Paragraph("Fonctionnalité réservée aux versions ultérieures raccordées aux partenaires réels.", styles['TableCell'])
        ],
        [
            Paragraph("503 Service Unavail.", styles['TableCellBold']),
            Paragraph("Clé secrète de passerelle USSD non renseignée, indisponibilité transitoire BDD.", styles['TableCell']),
            Paragraph("Échec de connexion réseau.", styles['TableCell']),
            Paragraph("Vérifier les variables d'environnement sur Render.com.", styles['TableCell'])
        ]
    ]
    story.append(make_table(error_data, [30*mm, 55*mm, 45*mm, 45*mm]))

    story.append(Paragraph("13.2 Procédure de Traitement d'Urgence des Incidents P0", styles['SectionTitle']))
    story.append(Paragraph(
        "<b>Incident P0-1 : Interruption de connectivité Base de Données (Neon)</b><br/>"
        "• <i>Constat :</i> Les requêtes retournent 500 avec message de connexion échouée.<br/>"
        "• <i>Remédiation :</i> Le backend intègre un mécanisme de reconnexion automatique avec backoff exponentiel "
        "(<code>withDbRetry</code>). Si la panne persiste, vérifier le quota d'activité et le statut de la branche Neon Cloud.<br/><br/>"
        "<b>Incident P0-2 : Désynchronisation de Caisse Guichet (Teller)</b><br/>"
        "• <i>Constat :</i> Écart entre le solde physique dans le tiroir-caisse et le solde informatique du guichet.<br/>"
        "• <i>Remédiation :</i> Le Branch Manager initie une session d'audit depuis l'écran <code>BranchDashboard.tsx</code>, "
        "consulte le journal des Cash-In et Cash-Out horodatés, et valide une opération de régularisation comptable dans <code>Treasury.tsx</code>.<br/><br/>"
        "<b>Incident P0-3 : Blocage d'un automate CRON</b><br/>"
        "• <i>Constat :</i> Les prélèvements d'affiliation ou les cycles de tontine ne sont pas exécutés à minuit.<br/>"
        "• <i>Remédiation :</i> Les fonctions sont idempotentes. Le Super Admin peut forcer le déclenchement immédiat "
        "sans risque de double débit depuis la console de commande ou par redémarrage propre du service Node.js.",
        styles['Body']
    ))

    story.append(Spacer(1, 10))
    story.append(make_callout(
        "Document certifié conforme au code source de la plateforme Mongain par l'équipe d'ingénierie logicielle. "
        "Toute reproduction ou diffusion sans accord préalable de la direction de Mongain est strictement prohibée.",
        "MENTION DE CERTIFICATION TECHNIQUE", "success", styles
    ))

    doc.build(story, canvasmaker=NumberedCanvas)
    print(f"[+] Succès : Document PDF généré avec succès -> {OUTPUT_PDF}")


if __name__ == '__main__':
    build_pdf()
