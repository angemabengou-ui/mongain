from datetime import datetime
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Image
from reportlab.lib.colors import HexColor

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / 'Mongain_investor_pitch.pdf'

# Theme
PRIMARY = HexColor('#0F172A')
ACCENT = HexColor('#2563EB')
GREEN = HexColor('#16A34A')
ORANGE = HexColor('#F59E0B')
RED = HexColor('#DC2626')
GRAY = HexColor('#64748B')
LIGHT = HexColor('#F8FAFC')

styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name='TitleWhite', fontName='Helvetica-Bold', fontSize=24, textColor='white', leading=28, spaceAfter=10))
styles.add(ParagraphStyle(name='SubtitleWhite', fontName='Helvetica', fontSize=11, textColor='white', leading=16, spaceAfter=12))
styles.add(ParagraphStyle(name='TitleDark', fontName='Helvetica-Bold', fontSize=22, textColor=PRIMARY, leading=26, spaceAfter=10))
styles.add(ParagraphStyle(name='HeadingDark', fontName='Helvetica-Bold', fontSize=15, textColor=PRIMARY, leading=18, spaceAfter=8))
styles.add(ParagraphStyle(name='BodyText', fontName='Helvetica', fontSize=10.5, textColor=PRIMARY, leading=14))
styles.add(ParagraphStyle(name='SmallBody', fontName='Helvetica', fontSize=9.5, textColor=PRIMARY, leading=13))
styles.add(ParagraphStyle(name='Bullet', fontName='Helvetica', fontSize=10.5, textColor=PRIMARY, leading=14, leftIndent=18, bulletIndent=12, spaceAfter=4))
styles.add(ParagraphStyle(name='Metric', fontName='Helvetica-Bold', fontSize=26, textColor=ACCENT, leading=30, alignment=1))
styles.add(ParagraphStyle(name='MetricLabel', fontName='Helvetica', fontSize=9, textColor=GRAY, leading=12, alignment=1))
styles.add(ParagraphStyle(name='Footer', fontName='Helvetica', fontSize=8, textColor=GRAY, leading=12))

# ----------------------
# Chart generation
# ----------------------

def save_user_growth_chart(path: Path):
    years = ['Y1', 'Y2', 'Y3', 'Y4', 'Y5']
    users = [150000, 350000, 600000, 850000, 1000000]
    plt.figure(figsize=(5.4, 2.8), facecolor='white')
    ax = plt.gca()
    ax.plot(years, users, marker='o', linewidth=2.8, color=ACCENT, markersize=6)
    ax.fill_between(years, users, 0, alpha=0.12, color=ACCENT)
    ax.set_title('Croissance utilisateurs', fontsize=9, color=PRIMARY)
    ax.set_ylabel('Utilisateurs', fontsize=8, color=PRIMARY)
    ax.set_ylim(0, 1100000)
    ax.grid(True, axis='y', linestyle='--', alpha=0.25)
    for spine in ax.spines.values():
        spine.set_color('#E2E8F0')
    plt.tight_layout()
    plt.savefig(path, dpi=220)
    plt.close()


def save_volume_chart(path: Path):
    years = ['Y1', 'Y2', 'Y3', 'Y4', 'Y5']
    volumes = [5, 12, 28, 60, 120]
    plt.figure(figsize=(5.4, 2.8), facecolor='white')
    bars = plt.bar(years, volumes, color=['#93C5FD', '#60A5FA', '#3B82F6', '#2563EB', '#1D4ED8'])
    plt.title('Volume traité (milliards FCFA)', fontsize=9, color=PRIMARY)
    plt.ylabel('Milliards FCFA', fontsize=8, color=PRIMARY)
    plt.ylim(0, 130)
    plt.grid(True, axis='y', linestyle='--', alpha=0.2)
    for spine in plt.gca().spines.values():
        spine.set_color('#E2E8F0')
    for b in bars:
        h = b.get_height()
        plt.text(b.get_x()+b.get_width()/2., h + 2, f'{int(h)}', ha='center', va='bottom', fontsize=7, color=PRIMARY)
    plt.tight_layout()
    plt.savefig(path, dpi=220)
    plt.close()


def save_revenue_chart(path: Path):
    years = ['Y1', 'Y2', 'Y3', 'Y4', 'Y5']
    revenue = [150, 360, 820, 1800, 3600]
    ebitda = [-110, 60, 300, 820, 1500]
    plt.figure(figsize=(5.4, 2.8), facecolor='white')
    ax = plt.gca()
    ax.plot(years, revenue, marker='o', linewidth=2.5, color=GREEN, label='Revenus (M FCFA)')
    ax.plot(years, ebitda, marker='s', linewidth=2.5, color=ORANGE, label='EBITDA (M FCFA)')
    ax.set_title('Revenus et EBITDA', fontsize=9, color=PRIMARY)
    ax.set_ylabel('M FCFA', fontsize=8, color=PRIMARY)
    ax.grid(True, linestyle='--', alpha=0.2)
    ax.legend(frameon=False, fontsize=7)
    for spine in ax.spines.values():
        spine.set_color('#E2E8F0')
    plt.tight_layout()
    plt.savefig(path, dpi=220)
    plt.close()


def save_ask_chart(path: Path):
    labels = ['Produit', 'Marketing', 'Salaires', 'Loyer & Infra', 'Conformité', 'Fonds de roulement']
    vals = [600, 450, 420, 200, 180, 150]
    colors_list = ['#2563EB', '#2DD4BF', '#F59E0B', '#A78BFA', '#F87171', '#38BDF8']
    plt.figure(figsize=(5.5, 3.2), facecolor='white')
    wedges, texts, autotexts = plt.pie(vals, labels=labels, autopct='%1.1f%%', startangle=90, colors=colors_list, textprops={'fontsize': 7, 'color': PRIMARY})
    for autot in autotexts:
        autot.set_color('white'); autot.set_fontsize(7); autot.set_fontweight('bold')
    plt.title('Utilisation du capital (2,0 Md FCFA)', fontsize=9, color=PRIMARY)
    plt.tight_layout()
    plt.savefig(path, dpi=220)
    plt.close()

# Prepare charts
for fn, func in [('user_growth.png', save_user_growth_chart), ('volume.png', save_volume_chart), ('revenue.png', save_revenue_chart), ('use_of_funds.png', save_ask_chart)]:
    func(ROOT / fn)

# -------------------------------------------------------------------
# Custom document
# -------------------------------------------------------------------

story = []

# Cover page
cover = [
    Paragraph('Mongain', style='TitleWhite'),
    Paragraph('La super-app du quotidien en zone CEMAC', style='SubtitleWhite'),
    Spacer(1, 10),
    Paragraph('Business plan & pitch investisseur', style='SubtitleWhite'),
    Spacer(1, 25),
    Table([
        ['Objectif marché', '1 million d’utilisateurs d’ici la 5e année'],
        ['Levée visée', '2 000 000 000 FCFA'],
        ['Pays cible', 'Gabon / CEMAC'],
        ['Modèle', 'micro-paiements + services du quotidien'],
    ], colWidths=[80*mm, 100*mm]),
    Spacer(1, 20),
    Paragraph('Le cash dit adieu au quotidien : payer le taxi, le pain, le transport, les services et les micro-achats sans friction.', style='SubtitleWhite'),
]

cover_table = Table(cover, colWidths=[170*mm])
cover_table.setStyle(TableStyle([
    ('BACKGROUND', (0, 0), (-1, -1), PRIMARY),
    ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ('GRID', (0, 0), (-1, -1), 0.5, colors.white),
    ('LEFTPADDING', (0, 0), (-1, -1), 12),
    ('RIGHTPADDING', (0, 0), (-1, -1), 12),
    ('TOPPADDING', (0, 0), (-1, -1), 12),
    ('BOTTOMPADDING', (0, 0), (-1, -1), 12),
]))

# Add background effect through a simple colored frame not actual cover image
cover_page = SimpleDocTemplate(str(OUTPUT), pagesize=A4, rightMargin=12*mm, leftMargin=12*mm, topMargin=10*mm, bottomMargin=10*mm)

# We will rebuild cleanly by including pages in order and not using the cover precomputed table.
# To keep it simple, we instead generate a normal document with pages as sections.

# Page 1: Cover
from reportlab.platypus import Frame

def add_cover():
    story = []
    story.append(Paragraph('Mongain', style='TitleWhite'))
    story.append(Paragraph('La super-app du quotidien en zone CEMAC', style='SubtitleWhite'))
    story.append(Spacer(1, 12))
    story.append(Paragraph('Business plan & pitch investisseur', style='SubtitleWhite'))
    story.append(Spacer(1, 20))
    data = [
        ['Objectif marché', '1 million d’utilisateurs d’ici la 5e année'],
        ['Levée visée', '2 000 000 000 FCFA'],
        ['Pays cible', 'Gabon / CEMAC'],
        ['Modèle', 'micro-paiements + services du quotidien'],
    ]
    table = Table(data, colWidths=[52*mm, 100*mm])
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), HexColor('#0F172A')),
        ('TEXTCOLOR', (0, 0), (-1, -1), colors.white),
        ('FONTNAME', (0, 0), (-1, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('GRID', (0, 0), (-1, -1), 0.7, colors.white),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
    ]))
    story.append(table)
    story.append(Spacer(1, 18))
    story.append(Paragraph('Le cash dit adieu au quotidien : payer le taxi, le pain, les services domestiques, le transport et les achats du jour sans friction.', style='SubtitleWhite'))
    return story

# Page 2: Executive summary and market opportunity

def summary_page():
    content = []
    content.append(Paragraph('1. Résumé exécutif', style='TitleDark'))
    content.append(Paragraph('Mongain est une super-app de paiement et de services quotidiens conçue pour le marché Gabon-CEMAC. Son objectif est d’unifier le paiement de micro-montants, le transfert, la recharge, la facturation, les services, la tontine et les caisses communes dans une expérience simple et accessible.', style='BodyText'))
    content.append(Spacer(1, 8))
    row1 = Table([
        ['150k', 'utilisateurs en Y1'],
        ['1M', 'utilisateurs visés en Y5'],
        ['120 Md', 'volume traité en Y5'],
    ], colWidths=[50*mm, 50*mm, 50*mm])
    row1.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), LIGHT),
        ('GRID', (0, 0), (-1, -1), 0.7, colors.HexColor('#E2E8F0')),
        ('TEXTCOLOR', (0, 0), (-1, -1), PRIMARY),
        ('FONTNAME', (0, 0), (-1, -1), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, -1), 16),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('TOPPADDING', (0, 0), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
    ]))
    content.append(row1)
    content.append(Spacer(1, 12))
    content.append(Paragraph('Pourquoi ce marché ?', style='HeadingDark'))
    bullets = [
        'Le cash domine encore le quotidien : pain, taxi, petit commerce, micro-services, paiements de proximité.',
        'Les opérateurs du marché ne proposent pas une solution simple pour les petites transactions du quotidien.',
        'Le besoin est réel, répété et massif : il ne s’agit pas d’un produit de niche, mais d’une infrastructure de vie quotidienne.',
        'Le Gabon et la zone CEMAC offrent un marché favorable à la digitalisation du secteur informel et des PME locales.'
    ]
    for b in bullets:
        content.append(Paragraph(f'• {b}', style='Bullet'))
    return content

# Page 3: Market and social impact

def market_page():
    content = []
    content.append(Paragraph('2. Marché cible et impact social', style='TitleDark'))
    content.append(Paragraph('Mongain cible les segments les plus importants du quotidien : ménages, commerçants, transporteurs, vendeurs ambulants, micro-entrepreneurs, travailleurs, étudiants et familles.', style='BodyText'))
    content.append(Spacer(1, 8))
    table = Table([
        ['Segment', 'Problème actuel', 'Solution Mongain'],
        ['Ménages / particuliers', 'Cash, coupures, manque de sécurité', 'Paiements simples, transfert, recharge, gestion quotidienne'],
        ['Petits commerçants', 'Peu de solutions adaptées aux micro-montants', 'QRcode, paiement rapide, historique et suivi'],
        ['Transport / taxi', 'Paiement manuel et peu dématérialisé', 'Paiements instantanés, cashless urbain'],
        ['Secteur informel', 'Absence de service moderne adapté', 'Tontines, caisses communes, micro-gestion'],
        ['Familles', 'Besoin de sécurité et de suivi', 'Comptes enfant, plafonds, supervision'],
    ], colWidths=[30*mm, 48*mm, 74*mm])
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), PRIMARY),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('BACKGROUND', (0, 1), (-1, -1), LIGHT),
        ('GRID', (0, 0), (-1, -1), 0.7, colors.HexColor('#CBD5E1')),
        ('FONTSIZE', (0, 0), (-1, -1), 8.5),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('LEFTPADDING', (0, 0), (-1, -1), 5),
        ('RIGHTPADDING', (0, 0), (-1, -1), 5),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]))
    content.append(table)
    content.append(Spacer(1, 12))
    content.append(Paragraph('Impact social clé :', style='HeadingDark'))
    for b in [
        'Réduction de la dépendance au cash physique.',
        'Formalisation du secteur informel et des micro-services.',
        'Protection des familles via comptes enfant et plafonds personnalisés.',
        'Accès plus large aux services financiers pour les populations moins favorisées.'
    ]:
        content.append(Paragraph(f'• {b}', style='Bullet'))
    return content

# Page 4: Product & wallet features

def product_page():
    content = []
    content.append(Paragraph('3. Produit : la plateforme du quotidien', style='TitleDark'))
    features = [
        'Paiement simple à partir de 100 FCFA et plus',
        'Paiement QR pour commerçants et services de proximité',
        'Transfert P2P rapide et sécurisé',
        'Recharge mobile et services de facturation',
        'Tontines et caisses communes digitales',
        'Comptes enfant avec supervision parentale',
        'Portefeuille personnel et gestion de micro-solde',
        'Espace marchand avec statistiques, historique et reporting'
    ]
    left = []
    right = []
    for i, item in enumerate(features):
        if i % 2 == 0:
            left.append(Paragraph(f'• {item}', style='Bullet'))
        else:
            right.append(Paragraph(f'• {item}', style='Bullet'))
    two_cols = Table([left, right], colWidths=[78*mm, 78*mm])
    content.append(two_cols)
    content.append(Spacer(1, 12))
    content.append(Paragraph('Ce qui fait la différence : l’application est pensée pour un usage quotidien et non seulement pour des montants élevés.', style='BodyText'))
    return content

# Page 5: Economic model and COBAC

def model_page():
    content = []
    content.append(Paragraph('4. Modèle économique et frais COBAC', style='TitleDark'))
    content.append(Paragraph('Mongain génère des revenus sur le volume, pas sur quelques grandes transactions. Le modèle est construit pour le micro-paiement et le service du quotidien.', style='BodyText'))
    content.append(Spacer(1, 8))
    table = Table([
        ['Source de revenus', 'Description', 'Impact'],
        ['Commission de transaction', 'Frais sur paiements et transferts', 'Le cœur du modèle'],
        ['Recharge & services', 'Télécom, factures, services', 'Revenu récurrent'],
        ['Espace marchand', 'Abonnement + services', 'Rend le commerce plus rentable'],
        ['Partenariats', 'Taxis, opérateurs, PME', 'Distribution massive'],
        ['API / B2B', 'Services intégrés aux acteurs locaux', 'Ventilation de revenus'],
    ], colWidths=[32*mm, 55*mm, 55*mm])
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), PRIMARY),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('BACKGROUND', (0, 1), (-1, -1), LIGHT),
        ('GRID', (0, 0), (-1, -1), 0.7, colors.HexColor('#CBD5E1')),
        ('FONTSIZE', (0, 0), (-1, -1), 8.5),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 5),
        ('RIGHTPADDING', (0, 0), (-1, -1), 5),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]))
    content.append(table)
    content.append(Spacer(1, 10))
    content.append(Paragraph('Frais COBAC / conformité / sécurité :', style='HeadingDark'))
    content.append(Paragraph('• Les frais de conformité, sécurité, cahier des charges réglementaire et mise en conformité COBAC sont intégrés dans le modèle de coût. Ils ne sont pas un coût optionnel : ils sont incontournables dans un modèle fintech crédible.', style='Bullet'))
    content.append(Paragraph('• Ce coût sert à sécuriser les comptes, protéger les utilisateurs, renforcer la conformité et garantir l’acceptabilité du produit auprès des partenaires.', style='Bullet'))
    return content

# Page 6: Use of funds

def investment_page():
    content = []
    content.append(Paragraph('5. Utilisation du capital : 2 000 000 000 FCFA', style='TitleDark'))
    table = Table([
        ['Rubrique', 'Montant (FCFA)'],
        ['Développement produit et app', '600 000 000'],
        ['Marketing et acquisition', '450 000 000'],
        ['Salaires et équipe', '420 000 000'],
        ['Loyer, bureau, réseau, infrastructure', '200 000 000'],
        ['Conformité, juridique, audit, COBAC', '180 000 000'],
        ['Fonds de roulement / sécurité', '150 000 000'],
        ['Total', '2 000 000 000'],
    ], colWidths=[120*mm, 40*mm])
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), PRIMARY),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('BACKGROUND', (0, 1), (-1, -1), LIGHT),
        ('GRID', (0, 0), (-1, -1), 0.7, colors.HexColor('#CBD5E1')),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('ALIGN', (1, 1), (1, -1), 'RIGHT'),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]))
    content.append(table)
    content.append(Spacer(1, 12))
    content.append(Paragraph('Coûts mensuels de démarrage', style='HeadingDark'))
    cost_table = Table([
        ['Poste', 'Mensuel'],
        ['Loyer / bureau / internet / téléphone', '8 000 000'],
        ['Publicité digitale et terrain', '18 000 000'],
        ['Salaires', '30 000 000'],
        ['Support client / opérations', '12 000 000'],
        ['Cloud / hébergement / cybersécurité', '4 000 000'],
        ['Total mensuel', '72 000 000'],
    ], colWidths=[115*mm, 35*mm])
    cost_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), PRIMARY),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('BACKGROUND', (0, 1), (-1, -1), LIGHT),
        ('GRID', (0, 0), (-1, -1), 0.7, colors.HexColor('#CBD5E1')),
        ('FONTSIZE', (0, 0), (-1, -1), 8.8),
        ('ALIGN', (1, 1), (1, -1), 'RIGHT'),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]))
    content.append(cost_table)
    return content

# Page 7: User growth and volume charts

def growth_page():
    content = []
    content.append(Paragraph('6. Évolution sur 5 ans : objectif 1 million d’utilisateurs', style='TitleDark'))
    content.append(Spacer(1, 6))
    content.append(Image(ROOT / 'user_growth.png', width=150*mm, height=70*mm))
    content.append(Spacer(1, 6))
    projection = Table([
        ['Année', 'Utilisateurs', 'Volume traité', 'Revenus', 'EBITDA'],
        ['Y1', '150 000', '5 Md FCFA', '150 M FCFA', '-110 M FCFA'],
        ['Y2', '350 000', '12 Md FCFA', '360 M FCFA', '60 M FCFA'],
        ['Y3', '600 000', '28 Md FCFA', '820 M FCFA', '300 M FCFA'],
        ['Y4', '850 000', '60 Md FCFA', '1,8 Md FCFA', '820 M FCFA'],
        ['Y5', '1 000 000', '120 Md FCFA', '3,6 Md FCFA', '1,5 Md FCFA'],
    ], colWidths=[18*mm, 30*mm, 34*mm, 30*mm, 30*mm])
    projection.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), PRIMARY),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('BACKGROUND', (0, 1), (-1, -1), LIGHT),
        ('GRID', (0, 0), (-1, -1), 0.7, colors.HexColor('#CBD5E1')),
        ('FONTSIZE', (0, 0), (-1, -1), 8.3),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('ALIGN', (1, 1), (-1, -1), 'CENTER'),
        ('LEFTPADDING', (0, 0), (-1, -1), 4),
        ('RIGHTPADDING', (0, 0), (-1, -1), 4),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
    ]))
    content.append(projection)
    return content

# Page 8: Profitability and investor return

def investor_page():
    content = []
    content.append(Paragraph('7. Rentabilité et retour pour les investisseurs', style='TitleDark'))
    content.append(Paragraph('Le modèle vise une forte progression du volume, puis de la rentabilité. À partir de la 3e année, les revenus générés par le volume de micro-transactions deviennent structurellement attractifs.', style='BodyText'))
    content.append(Spacer(1, 6))
    content.append(Image(ROOT / 'revenue.png', width=150*mm, height=70*mm))
    content.append(Spacer(1, 10))
    table = Table([
        ['Scénario illustratif', 'Hypothèse conservatrice'],
        ['Levée', '2 000 000 000 FCFA'],
        ['Part de capital investie', '20% du capital'],
        ['Sortie possible à 5 ans', '5x à 8x la levée sur base de croissance et EBITDA'],
        ['Rendement attendu', 'Très supérieur à un placement classique'],
        ['Valeur d’entreprise visée', 'À partir de 10 à 15 Md FCFA selon traction et expansion régionale'],
    ], colWidths=[68*mm, 75*mm])
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), PRIMARY),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('BACKGROUND', (0, 1), (-1, -1), LIGHT),
        ('GRID', (0, 0), (-1, -1), 0.7, colors.HexColor('#CBD5E1')),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 7),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
    ]))
    content.append(table)
    content.append(Spacer(1, 8))
    content.append(Paragraph('Ce qui attire les investisseurs :', style='HeadingDark'))
    bullets = [
        'Taille du marché réel, pas un marché théorique.',
        'Usage quotidien et réseau de distribution fort.',
        'Revenus liés au volume et à la fidélisation.',
        'Potentiel de développement dans toute la zone CEMAC.',
        'Produit rassurant pour les clients et crédible pour les partenaires.'
    ]
    for b in bullets:
        content.append(Paragraph(f'• {b}', style='Bullet'))
    return content

# Page 9: Security and compliance

def security_page():
    content = []
    content.append(Paragraph('8. Sécurité, conformité et inclusion', style='TitleDark'))
    content.append(Paragraph('Le projet a été pensé comme une plateforme de confiance, pas seulement comme une app de paiement.', style='BodyText'))
    content.append(Spacer(1, 8))
    table = Table([
        ['Fonction', 'Description'],
        ['Comptes Enfant', 'Suivi parentale, plafonds, sécurité des achats et gestion parentale'],
        ['Secteur informel', 'Tontines, caisses communes, micro-services et gestion collaborative'],
        ['Protection utilisateur', 'Vérifications KYC, sécurité session, parcours de confiance'],
        ['Conformité / COBAC', 'Régulation, audit, conformité et traçabilité'],
        ['Support', 'Aide, sécurité, support opérationnel, gestion des litiges'],
    ], colWidths=[55*mm, 95*mm])
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), PRIMARY),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('BACKGROUND', (0, 1), (-1, -1), LIGHT),
        ('GRID', (0, 0), (-1, -1), 0.7, colors.HexColor('#CBD5E1')),
        ('FONTSIZE', (0, 0), (-1, -1), 8.8),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 7),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
    ]))
    content.append(table)
    content.append(Spacer(1, 12))
    content.append(Paragraph('En résumé : la solution n’est pas seulement une app de paiement ; c’est une infrastructure du quotidien, capable de servir des ménages, des PME, des marchands, des familles et des segments informels encore largement non couverts.', style='BodyText'))
    return content

# Create doc

doc = SimpleDocTemplate(str(OUTPUT), pagesize=A4, rightMargin=12*mm, leftMargin=12*mm, topMargin=10*mm, bottomMargin=10*mm)

# Header with colored top band on each page (simple approach)

def add_header(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(ACCENT)
    canvas.rect(0, doc.height+doc.topMargin-18*mm, doc.width, 18*mm, fill=1, stroke=0)
    canvas.setFillColor(colors.white)
    canvas.setFont('Helvetica-Bold', 9)
    canvas.drawString(12*mm, doc.height+doc.topMargin-10*mm, 'Mongain - Business plan investisseur')
    canvas.restoreState()

# Build main story with pages
main_story = []
main_story += add_cover()
main_story.append(PageBreak())
main_story += summary_page(); main_story.append(PageBreak())
main_story += market_page(); main_story.append(PageBreak())
main_story += product_page(); main_story.append(PageBreak())
main_story += model_page(); main_story.append(PageBreak())
main_story += investment_page(); main_story.append(PageBreak())
main_story += growth_page(); main_story.append(PageBreak())
main_story += investor_page(); main_story.append(PageBreak())
main_story += security_page();
main_story.append(Spacer(1, 20))
main_story.append(Paragraph('Document préparé le %s' % datetime.now().strftime('%d/%m/%Y'), style='Footer'))

# Render final PDF

doc.build(main_story, onFirstPage=add_header, onLaterPages=add_header)

print(f'PDF généré: {OUTPUT}')
