from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor
from reportlab.pdfgen import canvas
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import Paragraph, Spacer, PageBreak, SimpleDocTemplate, Table, TableStyle

OUTPUT = r"d:\Users\om0886\Desktop\mongain\Mongain_investor_pitch.pdf"
styles = getSampleStyleSheet()
PRIMARY = HexColor('#0F172A')
ACCENT = HexColor('#2563EB')
TEAL = HexColor('#0EA5E9')
GREEN = HexColor('#16A34A')
ORANGE = HexColor('#F59E0B')
RED = HexColor('#DC2626')
LIGHT = HexColor('#F8FAFC')
GRAY = HexColor('#64748B')
BORDER = HexColor('#CBD5E1')
WHITE = HexColor('#FFFFFF')

styles.add(ParagraphStyle(name='TitleBig', fontName='Helvetica-Bold', fontSize=24, textColor=PRIMARY, leading=28, spaceAfter=10))
styles.add(ParagraphStyle(name='TitleWhite', fontName='Helvetica-Bold', fontSize=24, textColor=WHITE, leading=28, spaceAfter=10))
styles.add(ParagraphStyle(name='SubtitleWhite', fontName='Helvetica', fontSize=11, textColor=WHITE, leading=15, spaceAfter=10))
styles.add(ParagraphStyle(name='Heading', fontName='Helvetica-Bold', fontSize=15, textColor=PRIMARY, leading=18, spaceAfter=10))
styles.add(ParagraphStyle(name='Body', fontName='Helvetica', fontSize=10.5, textColor=PRIMARY, leading=15, spaceAfter=7))
styles.add(ParagraphStyle(name='BodyWhite', fontName='Helvetica', fontSize=10.2, textColor=WHITE, leading=14, spaceAfter=6))
styles.add(ParagraphStyle(name='Metric', fontName='Helvetica-Bold', fontSize=19, textColor=ACCENT, leading=22, alignment=1))
styles.add(ParagraphStyle(name='MetricLabel', fontName='Helvetica', fontSize=8.5, textColor=GRAY, leading=11, alignment=1))
styles.add(ParagraphStyle(name='Footer', fontName='Helvetica', fontSize=8, textColor=GRAY, leading=11))


def draw_header_footer(c, page_num):
    c.saveState()
    c.setFillColor(ACCENT)
    c.rect(0, 820, 595, 32, fill=1, stroke=0)
    c.setFillColor(WHITE)
    c.setFont('Helvetica-Bold', 9)
    c.drawString(20, 830, 'Mongain - Business plan investisseur')
    c.setFont('Helvetica', 8)
    c.drawRightString(575, 830, f'Page {page_num}')
    c.restoreState()


def draw_line_chart(c, x, y, w, h, values, labels, title, color=ACCENT):
    c.setStrokeColor(BORDER)
    c.setFillColor(PRIMARY)
    c.setFont('Helvetica-Bold', 10)
    c.drawString(x, y+h+15, title)

    min_v = min(values)
    max_v = max(values)
    if max_v == min_v:
        max_v += 1
    # Grid
    for i in range(5):
        yy = y + (h * i / 4)
        c.setStrokeColor(BORDER)
        c.line(x, yy, x + w, yy)

    # Plot line
    pts = []
    for i, val in enumerate(values):
        px = x + (i * w / (len(values)-1))
        py = y + ((max_v - val) / (max_v - min_v)) * h
        pts.append((px, py))
    c.setStrokeColor(color)
    c.setLineWidth(2.2)
    for i in range(len(pts)-1):
        c.line(pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1])
    for px, py in pts:
        c.setFillColor(color)
        c.circle(px, py, 3, fill=1, stroke=0)
    # x labels
    c.setFillColor(PRIMARY)
    c.setFont('Helvetica', 8)
    for i, lab in enumerate(labels):
        px = x + (i * w / (len(labels)-1))
        c.drawCentredString(px, y - 12, lab)
    # y label
    c.setFont('Helvetica', 8)
    c.drawString(x - 35, y + h - 8, f'{max_v}k')
    c.drawString(x - 35, y + 6, f'{min_v}k')


def draw_bar_chart(c, x, y, w, h, values, labels, title, colors=None):
    c.setFont('Helvetica-Bold', 10)
    c.setFillColor(PRIMARY)
    c.drawString(x, y + h + 15, title)
    max_v = max(values)
    bar_w = w / len(values) * 0.65
    gap = w / len(values) * 0.35
    for i, v in enumerate(values):
        px = x + i * (bar_w + gap) + 10
        bh = (v / max_v) * h
        fill = colors[i] if colors else ACCENT
        c.setFillColor(fill)
        c.roundRect(px, y, bar_w, bh, 4, fill=1, stroke=0)
        c.setFillColor(PRIMARY)
        c.setFont('Helvetica', 8)
        c.drawCentredString(px + bar_w/2, y - 12, labels[i])
        c.setFont('Helvetica-Bold', 7)
        c.drawCentredString(px + bar_w/2, y + bh + 8, str(v))


def draw_pie_chart(c, x, y, r, vals, labels, colors_list):
    total = sum(vals)
    start = 90
    for i, val in enumerate(vals):
        angle = 360 * val / total
        c.setFillColor(colors_list[i])
        c.setStrokeColor(WHITE)
        c.wedge(x, y, r, start - angle, angle, stroke=1, fill=1)
        start -= angle
    # labels
    c.setFillColor(PRIMARY)
    c.setFont('Helvetica-Bold', 8)
    for i, val in enumerate(vals):
        pct = val / total * 100
        c.drawString(x + r + 18, y + (len(vals)-i)*18 - 18, f'{labels[i]} {pct:.1f}%')


def page_cover(c):
    c.setFillColor(PRIMARY)
    c.rect(0, 0, 595, 842, fill=1, stroke=0)
    c.setFillColor(WHITE)
    c.setFont('Helvetica-Bold', 28)
    c.drawString(40, 720, 'MONGAIN')
    c.setFont('Helvetica-Bold', 18)
    c.drawString(40, 680, 'La super-app du quotidien en zone CEMAC')
    c.setFont('Helvetica', 11)
    c.drawString(40, 650, 'Business plan & pitch investisseur')
    # metric cards
    metrics = [
        ('Objectif', '1 million d’utilisateurs en 5 ans'),
        ('Levée', '2 000 000 000 FCFA'),
        ('Pays cible', 'Gabon / CEMAC'),
        ('Modèle', 'Micro-paiements + services du quotidien')
    ]
    y = 520
    for i, (k, v) in enumerate(metrics):
        x = 40 + (i % 2)*250
        yy = y - (i // 2)*90
        c.setFillColor(HexColor('#0B1220'))
        c.roundRect(x, yy, 210, 65, 8, fill=1, stroke=1)
        c.setFillColor(WHITE)
        c.setFont('Helvetica-Bold', 10)
        c.drawString(x+12, yy+45, k)
        c.setFont('Helvetica', 9)
        c.drawString(x+12, yy+20, v)
    c.setFont('Helvetica', 11)
    c.setFillColor(WHITE)
    c.drawString(40, 380, 'Le cash dit adieu au quotidien : payer le taxi, le pain, les services, la recharge')
    c.drawString(40, 360, 'et les micro-achats sans friction ni dépendance à l’argent liquide.')


def page_summary(c):
    draw_header_footer(c, 2)
    c.setFillColor(PRIMARY)
    c.setFont('Helvetica-Bold', 20)
    c.drawString(40, 770, '1. Résumé exécutif')
    para = [
        'Mongain est une super-app de paiement et de services quotidiens conçue pour le marché Gabon-CEMAC.',
        'Le produit permet de payer de petits montants, de transférer, de recharger, de payer des services, de gérer des tontines et des caisses communes, tout en gardant une expérience ultra simple.',
        'Le besoin est réel, répété et massif : le marché cible n’attend pas une app premium, il attend un outil quotidien simple, accessible et utile dans la vie de tous les jours.'
    ]
    y = 700
    for line in para:
        c.setFillColor(PRIMARY)
        c.setFont('Helvetica', 11)
        wrapped = []
        # simple manual wrap by words
        words = line.split()
        current = ''
        line_count = 0
        for word in words:
            if len(current + ' ' + word) < 100:
                current = (current + ' ' + word).strip()
            else:
                wrapped.append(current)
                current = word
        if current:
            wrapped.append(current)
        for text in wrapped:
            c.drawString(40, y, text)
            y -= 16
        y -= 8
    # metric blocks
    blocks = [
        ('150k', 'utilisateurs en Y1'),
        ('1M', 'utilisateurs visés en Y5'),
        ('120 Md', 'volume traité en Y5'),
    ]
    x0 = 40
    for i, (n, text) in enumerate(blocks):
        px = x0 + i*150
        c.setFillColor(LIGHT)
        c.roundRect(px, 500, 130, 70, 8, fill=1, stroke=1)
        c.setFillColor(ACCENT)
        c.setFont('Helvetica-Bold', 18)
        c.drawCentredString(px+65, 545, n)
        c.setFont('Helvetica', 8)
        c.drawCentredString(px+65, 518, text)


def page_market(c):
    draw_header_footer(c, 3)
    c.setFillColor(PRIMARY)
    c.setFont('Helvetica-Bold', 20)
    c.drawString(40, 780, '2. Marché cible et impact social')
    c.setFont('Helvetica', 10.5)
    text = 'Mongain cible les personnes et les structures qui vivent au quotidien avec le cash et les services de proximité : ménages, commerçants, taxis, transporteurs, vendeurs ambulants, familles et PME locales.'
    c.drawString(40, 745, text)
    table_data = [
        ('Segment', 'Problème', 'Solution Mongain'),
        ('Ménages', 'Cash, manque de sécurité, transactions lentes', 'Paiement simple, transfert rapide, recharge'),
        ('Commerçants', 'Micro-montants, faible adoption digitale', 'QR, caisse, historique, suivi'),
        ('Transport / taxi', 'Paiement manuel et peu digitalisé', 'Paiement instantané sans cash'),
        ('Secteur informel', 'Absence d’outil adapté', 'Tontine et caisse commune digitale'),
        ('Familles', 'Contrôle sur les dépenses des enfants', 'Compte enfant avec supervision')
    ]
    y = 630
    c.setFillColor(PRIMARY)
    c.setFont('Helvetica-Bold', 8)
    for i, row in enumerate(table_data):
        x = 40
        col_w = [110, 150, 260]
        # background by row
        if i == 0:
            c.setFillColor(PRIMARY)
            c.setFont('Helvetica-Bold', 8)
            row_fill = PRIMARY
            text_color = WHITE
        else:
            c.setFillColor(LIGHT)
            row_fill = LIGHT
            text_color = PRIMARY
        for j, cell in enumerate(row):
            xx = x + sum(col_w[:j])
            c.setFillColor(row_fill)
            c.roundRect(xx, y - 28, col_w[j], 28, 2, fill=1, stroke=1)
            c.setFillColor(text_color)
            c.drawString(xx+5, y-18, cell[:26])
        y -= 32
    c.setFillColor(PRIMARY)
    c.setFont('Helvetica-Bold', 12)
    c.drawString(40, 370, 'Impact social clé :')
    impacts = [
        'Réduction de la dépendance au cash physique.',
        'Formalisation du secteur informel et des micro-services.',
        'Sécurisation du quotidien via comptes enfant et plafonds.',
        'Accès plus large aux services financiers pour les populations non bancarisées.'
    ]
    yy = 345
    for el in impacts:
        c.setFont('Helvetica', 10.5)
        c.drawString(55, yy, '• ' + el)
        yy -= 20


def page_product(c):
    draw_header_footer(c, 4)
    c.setFillColor(PRIMARY)
    c.setFont('Helvetica-Bold', 20)
    c.drawString(40, 780, '3. Produit : la plateforme du quotidien')
    features = [
        'Paiement simple à partir de 100 FCFA',
        'Paiement QR pour commerçants et services de proximité',
        'Transfert P2P rapide et sécurisé',
        'Recharge mobile et services de facturation',
        'Tontines et caisses communes digitales',
        'Comptes enfant avec supervision parentale',
        'Portefeuille personal et gestion de micro-solde',
        'Espace marchand avec statistiques et historique',
    ]
    x = 60
    y = 660
    for i, item in enumerate(features):
        c.setFillColor(PRIMARY)
        c.setFont('Helvetica', 10.5)
        c.drawString(x, y, '• ' + item)
        if i % 2 == 1:
            y -= 35
        else:
            # second column
            if i == 1:
                x = 300
                y = 660
            elif i == 3:
                x = 300
                y = 590
            elif i == 5:
                x = 300
                y = 520
            elif i == 7:
                x = 300
                y = 450
    c.setFillColor(PRIMARY)
    c.setFont('Helvetica-Bold', 12)
    c.drawString(40, 390, 'Ce qui fait la différence :')
    c.setFont('Helvetica', 10.5)
    c.drawString(40, 365, 'L’application n’est pas conçue pour de gros montants seulement. Elle est pensée pour le quotidien,')
    c.drawString(40, 350, 'les petits paiements, les services de proximité et le besoin réel du marché informel.')


def page_model(c):
    draw_header_footer(c, 5)
    c.setFillColor(PRIMARY)
    c.setFont('Helvetica-Bold', 20)
    c.drawString(40, 780, '4. Modèle économique et coûts réglementaires')
    c.setFont('Helvetica', 10.8)
    c.drawString(40, 745, 'Mongain génère des revenus sur le volume, pas seulement sur quelques grandes transactions.')
    rows = [
        ('Source de revenus', 'Description', 'Impact'),
        ('Commission transaction', 'Fractions sur paiements et transferts', 'Cœur du modèle'),
        ('Recharge & services', 'Télécom, factures, services', 'Revenu récurrent'),
        ('Espace marchand', 'Abonnement + services', 'Rend le commerce plus rentable'),
        ('Partenariats', 'Taxis, opérateurs, PME', 'Distribution massive'),
        ('API / B2B', 'Intégration avec acteurs locaux', 'Cartographie d’un réseau')
    ]
    y = 650
    for i, row in enumerate(rows):
        if i == 0:
            c.setFillColor(PRIMARY)
            txt_color = WHITE
        else:
            c.setFillColor(LIGHT)
            txt_color = PRIMARY
        c.setFillColor(PRIMARY if i == 0 else LIGHT)
        c.roundRect(40, y-26, 120, 26, 2, fill=1, stroke=1)
        c.roundRect(160, y-26, 170, 26, 2, fill=1, stroke=1)
        c.roundRect(330, y-26, 200, 26, 2, fill=1, stroke=1)
        c.setFillColor(txt_color)
        c.setFont('Helvetica-Bold' if i == 0 else 'Helvetica', 8)
        for j, text in enumerate(row):
            x = [40, 160, 330][j]
            c.drawString(x+5, y-18, text[:26])
        y -= 28
    c.setFillColor(PRIMARY)
    c.setFont('Helvetica-Bold', 12)
    c.drawString(40, 360, 'Frais COBAC / conformité / sécurité :')
    c.setFillColor(PRIMARY)
    c.setFont('Helvetica', 10.5)
    text_lines = [
        '• Les frais de conformité, sécurité et mise en conformité COBAC sont intégrés dans le modèle et sont indispensables à la crédibilité du produit.',
        '• Ils servent à protéger les utilisateurs, sécuriser les comptes et rassurer les partenaires et les investisseurs.',
        '• L’app n’est pas seulement une interface : c’est une infrastructure financière de confiance.'
    ]
    yy = 335
    for line in text_lines:
        c.drawString(55, yy, line)
        yy -= 28


def page_investment(c):
    draw_header_footer(c, 6)
    c.setFillColor(PRIMARY)
    c.setFont('Helvetica-Bold', 20)
    c.drawString(40, 780, '5. Utilisation du capital : 2 000 000 000 FCFA')
    data = [
        ('Développement produit & app', '600 000 000'),
        ('Marketing & acquisition', '450 000 000'),
        ('Salaires & équipe', '420 000 000'),
        ('Loyer & infrastructure', '200 000 000'),
        ('Conformité & juridique', '180 000 000'),
        ('Fonds de roulement', '150 000 000'),
        ('Total', '2 000 000 000')
    ]
    y = 670
    for i, row in enumerate(data):
        if i == 0:
            c.setFillColor(PRIMARY)
            txt_color = WHITE
        else:
            c.setFillColor(LIGHT)
            txt_color = PRIMARY
        c.roundRect(40, y-25, 360, 25, 2, fill=1, stroke=1)
        c.roundRect(400, y-25, 120, 25, 2, fill=1, stroke=1)
        c.setFillColor(txt_color)
        c.setFont('Helvetica-Bold' if i == 0 else 'Helvetica', 8)
        c.drawString(50, y-17, row[0])
        c.drawRightString(500, y-17, row[1])
        y -= 28
    c.setFillColor(PRIMARY)
    c.setFont('Helvetica-Bold', 12)
    c.drawString(40, 260, 'Coûts mensuels de démarrage')
    c.setFillColor(PRIMARY)
    c.setFont('Helvetica', 10)
    costs = [
        ('Loyer / bureau / internet / téléphone', '8 000 000'),
        ('Publicité digitale & terrain', '18 000 000'),
        ('Salaires', '30 000 000'),
        ('Support client & opérations', '12 000 000'),
        ('Cloud / hébergement / cybersécurité', '4 000 000'),
        ('Total mensuel', '72 000 000'),
    ]
    yy = 220
    for label, val in costs:
        c.drawString(50, yy, label)
        c.drawRightString(500, yy, val)
        yy -= 18
    # simple pie chart use of funds
    draw_pie_chart(c, 420, 110, 68, [600, 450, 420, 200, 180, 150], ['Produit', 'Marketing', 'Salaire', 'Loyer', 'Conformité', 'Fonds'], [ACCENT, TEAL, ORANGE, GREEN, RED, HexColor('#A78BFA')])


def page_growth(c):
    draw_header_footer(c, 7)
    c.setFillColor(PRIMARY)
    c.setFont('Helvetica-Bold', 20)
    c.drawString(40, 790, '6. Évolution sur 5 ans : objectif 1 million d’utilisateurs')
    users = [150, 350, 600, 850, 1000]
    labels = ['Y1', 'Y2', 'Y3', 'Y4', 'Y5']
    draw_line_chart(c, 60, 420, 450, 190, users, labels, 'Croissance utilisateurs (k)', ACCENT)
    data = [
        ('Année', 'Utilisateurs', 'Volume traité', 'Revenus', 'EBITDA'),
        ('Y1', '150 000', '5 Md FCFA', '150 M FCFA', '-110 M FCFA'),
        ('Y2', '350 000', '12 Md FCFA', '360 M FCFA', '60 M FCFA'),
        ('Y3', '600 000', '28 Md FCFA', '820 M FCFA', '300 M FCFA'),
        ('Y4', '850 000', '60 Md FCFA', '1,8 Md FCFA', '820 M FCFA'),
        ('Y5', '1 000 000', '120 Md FCFA', '3,6 Md FCFA', '1,5 Md FCFA')
    ]
    y = 340
    for i, row in enumerate(data):
        if i == 0:
            c.setFillColor(PRIMARY)
            txt = WHITE
            fs = 'Helvetica-Bold'
        else:
            c.setFillColor(LIGHT)
            txt = PRIMARY
            fs = 'Helvetica'
        c.roundRect(40, y-18, 500, 22, 2, fill=1, stroke=1)
        c.setFillColor(txt)
        c.setFont(fs, 7.5)
        x = 50
        for cell in row:
            c.drawString(x, y-15, str(cell)[:22])
            x += 90
        y -= 22


def page_investor(c):
    draw_header_footer(c, 8)
    c.setFillColor(PRIMARY)
    c.setFont('Helvetica-Bold', 20)
    c.drawString(40, 790, '7. Rentabilité et retour pour les investisseurs')
    revenue = [150, 360, 820, 1800, 3600]
    ebitda = [-110, 60, 300, 820, 1500]
    # Revenue y-axis simple curve
    c.setFillColor(PRIMARY)
    c.setFont('Helvetica-Bold', 10)
    c.drawString(60, 390, 'Revenus et EBITDA (M FCFA)')
    lines = [
        ((60, 240), (120, 270)),
        ((120, 270), (180, 300)),
        ((180, 300), (240, 360)),
        ((240, 360), (300, 440)),
        ((300, 440), (390, 520)),
    ]
    for a, b in lines:
        c.setStrokeColor(ACCENT)
        c.line(a[0], a[1], b[0], b[1])
    # bar chart backend
    draw_bar_chart(c, 80, 120, 390, 180, [150, 360, 820, 1800, 3600], ['Y1', 'Y2', 'Y3', 'Y4', 'Y5'], 'Revenus (M FCFA)', [HexColor('#93C5FD'), HexColor('#60A5FA'), HexColor('#3B82F6'), HexColor('#2563EB'), HexColor('#1D4ED8')])
    table = [
        ('Scénario illustratif', 'Hypothèse conservatrice'),
        ('Levée', '2 000 000 000 FCFA'),
        ('Sortie possible', '5x à 8x la levée sur 5 ans'),
        ('Rendement attendu', 'Très supérieur à un placement classique'),
        ('Valeur d’entreprise visée', '10 à 15 Md FCFA selon traction')
    ]
    yy = 620
    for i, row in enumerate(table):
        if i == 0:
            c.setFillColor(PRIMARY)
            txt = WHITE
        else:
            c.setFillColor(LIGHT)
            txt = PRIMARY
        c.roundRect(40, yy-22, 220, 22, 2, fill=1, stroke=1)
        c.roundRect(260, yy-22, 220, 22, 2, fill=1, stroke=1)
        c.setFillColor(txt)
        c.setFont('Helvetica-Bold' if i == 0 else 'Helvetica', 8)
        c.drawString(50, yy-16, row[0])
        c.drawString(270, yy-16, row[1])
        yy -= 24


def page_security(c):
    draw_header_footer(c, 9)
    c.setFillColor(PRIMARY)
    c.setFont('Helvetica-Bold', 20)
    c.drawString(40, 790, '8. Sécurité, conformité et inclusion')
    rows = [
        ('Fonction', 'Description'),
        ('Comptes Enfant', 'Supervision parentale, plafonds et sécurité'),
        ('Secteur informel', 'Tontines, caisses communes, micro-services'),
        ('Protection utilisateur', 'KYC, sécurité de session, traçabilité'),
        ('Conformité / COBAC', 'Audit, conformité et supervision réglementaire'),
        ('Support', 'Aide, gestion des litiges et assistance')
    ]
    y = 670
    for i, row in enumerate(rows):
        if i == 0:
            c.setFillColor(PRIMARY)
            txt = WHITE
        else:
            c.setFillColor(LIGHT)
            txt = PRIMARY
        c.roundRect(40, y-26, 170, 26, 2, fill=1, stroke=1)
        c.roundRect(210, y-26, 300, 26, 2, fill=1, stroke=1)
        c.setFillColor(txt)
        c.setFont('Helvetica-Bold' if i == 0 else 'Helvetica', 8)
        c.drawString(50, y-18, row[0])
        c.drawString(220, y-18, row[1])
        y -= 28
    c.setFillColor(PRIMARY)
    c.setFont('Helvetica-Bold', 12)
    c.drawString(40, 330, 'Conclusion')
    c.setFont('Helvetica', 10.5)
    explanations = [
        'Mongain n’est pas seulement une app de paiement : c’est une infrastructure du quotidien,',
        'capable de servir des ménages, des commerçants, des PME, des familles et des populations non service par les grandes plateformes.',
        'Le produit est simple, utile, utile tous les jours et facilement scalable dans la zone CEMAC.'
    ]
    yy = 300
    for line in explanations:
        c.drawString(40, yy, line)
        yy -= 18
    c.setFillColor(ACCENT)
    c.setFont('Helvetica-Bold', 13)
    c.drawString(40, 150, 'Investir dans Mongain, c’est financer une infrastructure de paiement du quotidien.')
    c.setFont('Helvetica', 10)
    c.drawString(40, 125, 'Document préparé en vue d’une levée de fonds de 2 000 000 000 FCFA.')


# main
c = canvas.Canvas(OUTPUT, pagesize=A4)
page_cover(c); c.showPage()
page_summary(c); c.showPage()
page_market(c); c.showPage()
page_product(c); c.showPage()
page_model(c); c.showPage()
page_investment(c); c.showPage()
page_growth(c); c.showPage()
page_investor(c); c.showPage()
page_security(c)
c.save()
print(f'PDF created: {OUTPUT}')
