"""
Génère le guide d'installation et de déploiement Tcheyna au format PDF.

Usage
-----
    pip install -r docs/requirements.txt
    python docs/generer_guide.py                 # écrit à la racine du dépôt
    python docs/generer_guide.py chemin/vers.pdf # ou à l'emplacement indiqué

Le contenu du guide est écrit en fin de fichier, section « Contenu ». Il
double le README à destination d'un lecteur qui découvre le projet : à
chaque évolution des étapes d'installation, mettre les deux à jour.

Charte reprise de l'application : bleu nuit #1E3A5F, orange #F97316.

Note sur les polices : le document utilise Helvetica et Courier, les polices
standard du PDF, pour rester lisible partout sans embarquer de fichier. Elles
se limitent au jeu Latin-1 — les accents passent, mais pas les caractères de
dessin d'arbre ni les flèches dans les blocs de code. `bloc_code` signale
tout caractère hors de ce jeu au lieu de laisser un carré noir dans le PDF.
"""
import sys
from datetime import date
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

RACINE = Path(__file__).resolve().parent.parent
SORTIE = (sys.argv[1] if len(sys.argv) > 1
          else str(RACINE / "Tcheyna-Guide-Installation-Deploiement.pdf"))

# ─── Palette ─────────────────────────────────────────────────
NUIT = colors.HexColor("#1E3A5F")
NUIT_FONCE = colors.HexColor("#0F2040")
ORANGE = colors.HexColor("#F97316")
ORANGE_CLAIR = colors.HexColor("#FFF7ED")
FOND = colors.HexColor("#F0F4FA")
TEXTE = colors.HexColor("#1E293B")
TEXTE_DOUX = colors.HexColor("#64748B")
TEXTE_TENU = colors.HexColor("#94A3B8")
BORDURE = colors.HexColor("#E2E8F0")
SUCCES = colors.HexColor("#10B981")
SUCCES_CLAIR = colors.HexColor("#ECFDF5")
ATTENTION_CLAIR = colors.HexColor("#FEF3C7")
ATTENTION = colors.HexColor("#D97706")

MARGE = 20 * mm
LARGEUR_UTILE = A4[0] - 2 * MARGE

# ─── Styles ──────────────────────────────────────────────────
base = getSampleStyleSheet()

S = {
    "titre_couv": ParagraphStyle(
        "titre_couv", parent=base["Title"], fontName="Helvetica-Bold",
        fontSize=30, leading=36, textColor=colors.white, alignment=TA_CENTER,
        spaceAfter=0),
    "sstitre_couv": ParagraphStyle(
        "sstitre_couv", parent=base["Normal"], fontName="Helvetica",
        fontSize=13, leading=20, textColor=colors.HexColor("#FFFFFF"),
        alignment=TA_CENTER),
    "meta_couv": ParagraphStyle(
        "meta_couv", parent=base["Normal"], fontName="Helvetica",
        fontSize=9.5, leading=16, textColor=colors.HexColor("#94A3B8"),
        alignment=TA_CENTER),
    "h1": ParagraphStyle(
        "h1", parent=base["Heading1"], fontName="Helvetica-Bold",
        fontSize=17, leading=22, textColor=NUIT, spaceBefore=0, spaceAfter=3),
    "h2": ParagraphStyle(
        "h2", parent=base["Heading2"], fontName="Helvetica-Bold",
        fontSize=12, leading=16, textColor=NUIT, spaceBefore=13, spaceAfter=5),
    "h3": ParagraphStyle(
        "h3", parent=base["Heading3"], fontName="Helvetica-Bold",
        fontSize=10, leading=14, textColor=ORANGE, spaceBefore=10, spaceAfter=4),
    "p": ParagraphStyle(
        "p", parent=base["BodyText"], fontName="Helvetica",
        fontSize=9.5, leading=14.5, textColor=TEXTE, alignment=TA_JUSTIFY,
        spaceAfter=7),
    "p_petit": ParagraphStyle(
        "p_petit", parent=base["BodyText"], fontName="Helvetica",
        fontSize=8.5, leading=13, textColor=TEXTE_DOUX, spaceAfter=5),
    "puce": ParagraphStyle(
        "puce", parent=base["BodyText"], fontName="Helvetica",
        fontSize=9.5, leading=14, textColor=TEXTE, leftIndent=11,
        bulletIndent=2, spaceAfter=3.5),
    "code": ParagraphStyle(
        "code", parent=base["Code"], fontName="Courier",
        fontSize=8.5, leading=12.5, textColor=colors.HexColor("#E2E8F0"),
        leftIndent=0, firstLineIndent=0, spaceBefore=0, spaceAfter=0),
    "libelle_section": ParagraphStyle(
        "libelle_section", parent=base["BodyText"], fontName="Helvetica-Bold",
        fontSize=7.5, leading=10, textColor=ORANGE, spaceAfter=2),
    "cellule": ParagraphStyle(
        "cellule", parent=base["BodyText"], fontName="Helvetica",
        fontSize=8.5, leading=12, textColor=TEXTE, spaceAfter=0),
    "cellule_gras": ParagraphStyle(
        "cellule_gras", parent=base["BodyText"], fontName="Helvetica-Bold",
        fontSize=8.5, leading=12, textColor=NUIT, spaceAfter=0),
    "cellule_code": ParagraphStyle(
        "cellule_code", parent=base["BodyText"], fontName="Courier",
        fontSize=8, leading=11.5, textColor=TEXTE, spaceAfter=0),
    "entete_tab": ParagraphStyle(
        "entete_tab", parent=base["BodyText"], fontName="Helvetica-Bold",
        fontSize=8.5, leading=11.5, textColor=colors.white, spaceAfter=0),
    "encart": ParagraphStyle(
        "encart", parent=base["BodyText"], fontName="Helvetica",
        fontSize=9, leading=13.5, textColor=TEXTE, spaceAfter=0),
    "encart_titre": ParagraphStyle(
        "encart_titre", parent=base["BodyText"], fontName="Helvetica-Bold",
        fontSize=9, leading=13, textColor=NUIT, spaceAfter=3),
    "toc": ParagraphStyle(
        "toc", parent=base["BodyText"], fontName="Helvetica",
        fontSize=10, leading=15, textColor=TEXTE, spaceAfter=0),
    "toc_num": ParagraphStyle(
        "toc_num", parent=base["BodyText"], fontName="Helvetica-Bold",
        fontSize=10, leading=15, textColor=ORANGE, spaceAfter=0),
}


# ─── Briques de mise en page ─────────────────────────────────

def filet(couleur=BORDURE, epaisseur=1.4, largeur=None):
    t = Table([[""]], colWidths=[largeur or LARGEUR_UTILE], rowHeights=[epaisseur])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), couleur),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    return t


def titre_section(numero, texte):
    """Intitulé de section : surtitre orange, titre, filet de séparation."""
    blocs = []
    if numero:
        blocs.append(Paragraph(f"SECTION&nbsp;{numero}", S["libelle_section"]))
    blocs.append(Paragraph(texte, S["h1"]))
    blocs.append(Spacer(1, 5))
    blocs.append(filet())
    blocs.append(Spacer(1, 10))
    # Un titre ne doit jamais rester seul en bas de page.
    return [KeepTogether(blocs)]


# Courier n'a que le jeu Latin-1 : tout caractère au-delà (dessin d'arbre,
# flèches, guillemets typographiques) rendrait un carré noir.
AVERTISSEMENTS = []


def bloc_code(lignes, titre=None):
    """Bloc de commandes sur fond sombre."""
    for ligne in lignes:
        hors_jeu = {c for c in ligne if ord(c) > 255}
        if hors_jeu:
            AVERTISSEMENTS.append(
                f"caractère non rendu par Courier {sorted(hors_jeu)} dans : {ligne[:50]}")

    contenu = []
    for ligne in lignes:
        echappee = ligne.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        if echappee.strip().startswith("#"):
            contenu.append(f'<font color="#7DD3FC">{echappee}</font>')
        elif echappee.strip() == "":
            contenu.append("&nbsp;")
        else:
            contenu.append(echappee.replace(" ", "&nbsp;"))
    corps = Paragraph("<br/>".join(contenu), S["code"])

    lignes_tab = []
    if titre:
        lignes_tab.append([Paragraph(
            f'<font color="#94A3B8" size="7.5"><b>{titre.upper()}</b></font>', S["code"])])
    lignes_tab.append([corps])

    t = Table(lignes_tab, colWidths=[LARGEUR_UTILE])
    style = [
        ("BACKGROUND", (0, 0), (-1, -1), NUIT_FONCE),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (0, 0), 8),
        ("BOTTOMPADDING", (0, -1), (-1, -1), 9),
        ("ROUNDEDCORNERS", [5, 5, 5, 5]),
    ]
    if titre:
        style += [("BOTTOMPADDING", (0, 0), (0, 0), 2), ("TOPPADDING", (0, 1), (0, 1), 0)]
    t.setStyle(TableStyle(style))
    return [t, Spacer(1, 9)]


def encart(titre, texte, ton="info"):
    """Encart coloré : information, réussite ou vigilance."""
    fonds = {"info": FOND, "ok": SUCCES_CLAIR, "attention": ATTENTION_CLAIR}
    barres = {"info": NUIT, "ok": SUCCES, "attention": ATTENTION}
    interieur = [Paragraph(titre, S["encart_titre"]), Paragraph(texte, S["encart"])]

    t = Table([[ "", interieur]], colWidths=[3, LARGEUR_UTILE - 3])
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, 0), barres[ton]),
        ("BACKGROUND", (1, 0), (1, 0), fonds[ton]),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (0, 0), 0),
        ("RIGHTPADDING", (0, 0), (0, 0), 0),
        ("TOPPADDING", (0, 0), (0, 0), 0),
        ("BOTTOMPADDING", (0, 0), (0, 0), 0),
        ("LEFTPADDING", (1, 0), (1, 0), 11),
        ("RIGHTPADDING", (1, 0), (1, 0), 11),
        ("TOPPADDING", (1, 0), (1, 0), 9),
        ("BOTTOMPADDING", (1, 0), (1, 0), 10),
    ]))
    return [t, Spacer(1, 10)]


def tableau(entetes, lignes, largeurs, styles_colonnes=None):
    """Tableau à en-tête bleu nuit et lignes alternées."""
    styles_colonnes = styles_colonnes or ["cellule"] * len(entetes)
    donnees = [[Paragraph(h, S["entete_tab"]) for h in entetes]]
    for ligne in lignes:
        donnees.append([Paragraph(str(c), S[styles_colonnes[i]]) for i, c in enumerate(ligne)])

    t = Table(donnees, colWidths=largeurs, repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), NUIT),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
        ("LINEBELOW", (0, 1), (-1, -1), 0.4, BORDURE),
    ]
    for i in range(1, len(donnees)):
        if i % 2 == 0:
            style.append(("BACKGROUND", (0, i), (-1, i), colors.HexColor("#F8FAFC")))
    t.setStyle(TableStyle(style))
    return [t, Spacer(1, 10)]


def puces(elements):
    return [Paragraph(e, S["puce"], bulletText="•") for e in elements]


# ─── Gabarits de page ────────────────────────────────────────

def page_couverture(canvas, doc):
    """Couverture : dégradé bleu nuit et halos orange, comme l'écran d'accueil."""
    canvas.saveState()
    largeur, hauteur = A4

    # Dégradé simulé par bandes horizontales, du plus sombre en haut
    etapes = 90
    for i in range(etapes):
        ratio = i / (etapes - 1)
        # Interpolation NUIT_FONCE -> NUIT -> NUIT_FONCE
        k = 1 - abs(ratio - 0.45) / 0.55
        canvas.setFillColorRGB(
            0.059 + (0.118 - 0.059) * k,
            0.125 + (0.227 - 0.125) * k,
            0.251 + (0.373 - 0.251) * k,
        )
        canvas.rect(0, hauteur * (1 - (i + 1) / etapes), largeur,
                    hauteur / etapes + 1, fill=1, stroke=0)

    # Halos orange : disques concentriques de faible opacité, qui s'additionnent
    # vers le centre et produisent un dégradé sans bord net.
    canvas.setFillColor(ORANGE)
    for cx, cy, rayon, opacite_centre in (
        (largeur - 8 * mm, hauteur - 12 * mm, 52 * mm, 0.14),
        (-2 * mm, 62 * mm, 44 * mm, 0.10),
    ):
        anneaux = 24
        # Opacité par disque telle que le cumul au centre atteigne la cible
        alpha = 1 - (1 - opacite_centre) ** (1 / anneaux)
        canvas.setFillAlpha(alpha)
        for i in range(anneaux, 0, -1):
            canvas.circle(cx, cy, rayon * i / anneaux, fill=1, stroke=0)
    canvas.setFillAlpha(1)

    # Bandeau de pied de couverture
    canvas.setFillColor(ORANGE)
    canvas.rect(0, 0, largeur, 2.4 * mm, fill=1, stroke=0)
    canvas.restoreState()


def page_courante(canvas, doc):
    canvas.saveState()
    largeur, hauteur = A4

    # Bandeau supérieur
    canvas.setFillColor(NUIT)
    canvas.rect(0, hauteur - 13 * mm, largeur, 13 * mm, fill=1, stroke=0)
    canvas.setFillColor(colors.white)
    canvas.setFont("Helvetica-Bold", 9)
    canvas.drawString(MARGE, hauteur - 8.6 * mm, "tcheyna")
    canvas.setFillColor(colors.HexColor("#94A3B8"))
    canvas.setFont("Helvetica", 7.5)
    canvas.drawRightString(largeur - MARGE, hauteur - 8.6 * mm,
                           "Guide d'installation et de déploiement")

    # Pied de page
    canvas.setStrokeColor(BORDURE)
    canvas.setLineWidth(0.5)
    canvas.line(MARGE, 14 * mm, largeur - MARGE, 14 * mm)
    canvas.setFillColor(TEXTE_TENU)
    canvas.setFont("Helvetica", 7.5)
    canvas.drawString(MARGE, 10 * mm, "Tcheyna — Conakry, République de Guinée")
    canvas.setFillColor(ORANGE)
    canvas.setFont("Helvetica-Bold", 8)
    canvas.drawRightString(largeur - MARGE, 10 * mm, str(canvas.getPageNumber() - 1))
    canvas.restoreState()


doc = BaseDocTemplate(
    SORTIE, pagesize=A4,
    leftMargin=MARGE, rightMargin=MARGE, topMargin=MARGE, bottomMargin=MARGE,
    title="Tcheyna — Guide d'installation et de déploiement",
    author="Jean Faya Kamano",
    subject="Procédure de lancement local et de mise en production",
)

cadre_couv = Frame(MARGE, MARGE, LARGEUR_UTILE, A4[1] - 2 * MARGE, id="couv")
cadre_texte = Frame(MARGE, 18 * mm, LARGEUR_UTILE, A4[1] - 18 * mm - 18 * mm, id="texte")

doc.addPageTemplates([
    PageTemplate(id="couverture", frames=[cadre_couv], onPage=page_couverture),
    PageTemplate(id="courante", frames=[cadre_texte], onPage=page_courante),
])

# ─── Contenu ─────────────────────────────────────────────────
H = []

# Couverture — le bloc de titre est centré, les mentions calées en bas
H.append(Spacer(1, 74 * mm))
H.append(Paragraph("tcheyna", S["titre_couv"]))
H.append(Spacer(1, 7 * mm))

# Filet orange centré, qui rattache le titre au logotype
rule = Table([[""]], colWidths=[24 * mm], rowHeights=[1.8])
rule.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), ORANGE),
    ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
]))
conteneur = Table([[rule]], colWidths=[LARGEUR_UTILE])
conteneur.setStyle(TableStyle([
    ("ALIGN", (0, 0), (-1, -1), "CENTER"),
    ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
]))
H.append(conteneur)
H.append(Spacer(1, 9 * mm))

H.append(Paragraph(
    '<font color="#F97316"><b>Guide d\'installation<br/>et de déploiement</b></font>',
    ParagraphStyle("titre_doc", parent=S["sstitre_couv"], fontSize=21, leading=28)))
H.append(Spacer(1, 6 * mm))
H.append(Paragraph(
    "Lancer la plateforme en local,<br/>puis la mettre en production",
    S["sstitre_couv"]))

H.append(Spacer(1, 66 * mm))
H.append(Paragraph(
    '<font color="#CBD5E1">La location immobilière, en toute confiance</font><br/>'
    "Conakry, République de Guinée", S["meta_couv"]))
H.append(Spacer(1, 7 * mm))
H.append(Paragraph(
    f"Version 1.1 &nbsp;·&nbsp; {date.today().strftime('%d/%m/%Y')}<br/>"
    "Jean Faya Kamano, fondateur", S["meta_couv"]))

H.append(NextPageTemplate("courante"))
H.append(PageBreak())

# ─── Sommaire ────────────────────────────────────────────────
H += titre_section("", "Sommaire")
sommaire = [
    ("1", "Ce que contient le projet", "L'architecture en deux applications"),
    ("2", "Prérequis", "Ce qu'il faut installer avant de commencer"),
    ("3", "Lancer l'application en local", "Backend, frontend et comptes de démonstration"),
    ("4", "Mettre en production", "Base de données Supabase et hébergement Render"),
    ("5", "Activer les services tiers", "SMS Africa's Talking et paiements CinetPay"),
    ("6", "Vérifier que tout fonctionne", "Contrôles après installation ou déploiement"),
    ("7", "Résoudre les problèmes courants", "Symptômes, causes et corrections"),
    ("8", "Aide-mémoire des commandes", "Les commandes utiles au quotidien"),
]
lignes_som = [
    [Paragraph(n, S["toc_num"]),
     Paragraph(f"<b>{t}</b><br/><font color='#94A3B8' size='8'>{d}</font>", S["toc"])]
    for n, t, d in sommaire
]
t_som = Table(lignes_som, colWidths=[10 * mm, LARGEUR_UTILE - 10 * mm])
t_som.setStyle(TableStyle([
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("TOPPADDING", (0, 0), (-1, -1), 6),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ("LINEBELOW", (0, 0), (-1, -2), 0.4, BORDURE),
    ("LEFTPADDING", (0, 0), (0, -1), 0),
]))
H.append(t_som)
H.append(Spacer(1, 12))

H += encart(
    "À qui s'adresse ce document",
    "Il décrit deux parcours : faire tourner Tcheyna sur un poste de développement "
    "(sections 1 à 3), et le déployer sur Internet (sections 4 et 5). Les deux se "
    "suivent dans l'ordre. Aucune connaissance préalable du projet n'est supposée.",
)

H.append(PageBreak())

# ─── 1. Contenu du projet ────────────────────────────────────
H += titre_section("1", "Ce que contient le projet")
H.append(Paragraph(
    "Tcheyna est constitué de <b>deux applications indépendantes</b> qui communiquent "
    "par une API REST. Elles vivent dans le même dépôt mais se lancent et se déploient "
    "séparément.", S["p"]))

# Les caractères de dessin d'arbre (├ │ └) n'existent pas dans Courier :
# on utilise des connecteurs ASCII, rendus fidèlement partout.
H += bloc_code([
    "Tcheyna/",
    "|",
    "+-- backend/            API REST - Python / Flask",
    "|   +-- app/",
    "|   |   +-- models.py       Utilisateurs, annonces, passeports...",
    "|   |   +-- routes/         Un fichier par domaine métier",
    "|   |   +-- services/       Moteur de matching, notifications",
    "|   +-- config.py",
    "|   +-- run.py              Point d'entrée du serveur",
    "|   +-- seed.py             Données de démonstration",
    "|   +-- requirements.txt",
    "|",
    "+-- frontend/           Interface web - React / Vite",
    "|   +-- src/",
    "|   |   +-- api/            Appels au backend",
    "|   |   +-- components/     Éléments réutilisables",
    "|   |   +-- pages/          Écrans locataire, propriétaire, admin",
    "|   +-- package.json",
    "|",
    "+-- render.yaml         Configuration de déploiement",
    "+-- README.md",
], titre="Arborescence")

H.append(Paragraph("<b>Rôle de chaque application</b>", S["h3"]))
H += tableau(
    ["Application", "Rôle", "Port en local"],
    [
        ["<b>backend</b>",
         "Contient toute la logique métier : niveaux de confiance, certification "
         "des annonces, matching, paiements. C'est la seule à parler à la base de données.",
         "5000"],
        ["<b>frontend</b>",
         "Affiche l'interface et appelle le backend. Ne contient aucune règle métier : "
         "il ne fait qu'afficher ce que l'API renvoie.",
         "5173"],
    ],
    [26 * mm, LARGEUR_UTILE - 26 * mm - 24 * mm, 24 * mm],
)

H += encart(
    "Pourquoi cette séparation",
    "Les règles de confiance et les montants sont calculés côté serveur uniquement. "
    "Un utilisateur ne peut donc pas contourner un niveau de vérification ni modifier "
    "le prix qu'il paie en manipulant la page web.",
)

H.append(PageBreak())

# ─── 2. Prérequis ────────────────────────────────────────────
H += titre_section("2", "Prérequis")
H.append(Paragraph(
    "Trois outils à installer avant toute chose. Les versions indiquées sont les "
    "minimums testés.", S["p"]))

H += tableau(
    ["Outil", "Version", "À quoi il sert", "Où l'obtenir"],
    [
        ["<b>Python</b>", "3.11+", "Faire tourner le backend", "python.org/downloads"],
        ["<b>Node.js</b>", "20+", "Faire tourner le frontend", "nodejs.org"],
        ["<b>Git</b>", "—", "Récupérer et versionner le code", "git-scm.com"],
    ],
    [22 * mm, 16 * mm, LARGEUR_UTILE - 22 * mm - 16 * mm - 38 * mm, 38 * mm],
)

H.append(Paragraph("Vérifier que tout est bien installé", S["h3"]))
H += bloc_code([
    "python --version      # doit afficher 3.11 ou plus",
    "node --version        # doit afficher v20 ou plus",
    "git --version",
])

H += encart(
    "Sous Windows",
    "À l'installation de Python, cochez impérativement la case "
    "<b>« Add Python to PATH »</b>. Sans elle, la commande <font face='Courier'>python</font> "
    "reste introuvable dans le terminal.",
    ton="attention",
)

H.append(Paragraph(
    "<b>Aucun compte externe n'est nécessaire pour démarrer.</b> Les services de SMS et "
    "de paiement (section 5) sont facultatifs : sans eux, l'application fonctionne "
    "entièrement, en mode dégradé documenté.", S["p"]))

H.append(PageBreak())

# ─── 3. Lancer en local ──────────────────────────────────────
H += titre_section("3", "Lancer l'application en local")
H.append(Paragraph(
    "Le lancement se fait en <b>deux terminaux séparés</b>, un par application. "
    "Laissez les deux ouverts pendant toute la session de travail.", S["p"]))

H.append(Paragraph("Étape 1 — Récupérer le code", S["h3"]))
H += bloc_code([
    "git clone <adresse-du-depot> Tcheyna",
    "cd Tcheyna",
], titre="Terminal")

H.append(Paragraph("Étape 2 — Démarrer le backend (terminal n° 1)", S["h3"]))
H += bloc_code([
    "cd backend",
    "",
    "# Créer un environnement Python isolé",
    "python -m venv .venv",
    "",
    "# L'activer sous Windows :",
    ".venv\\Scripts\\activate",
    "# L'activer sous Linux ou macOS :",
    "source .venv/bin/activate",
    "",
    "# Installer les dépendances",
    "pip install -r requirements.txt",
    "",
    "# Créer le fichier de configuration",
    "copy .env.example .env        # Windows",
    "cp .env.example .env          # Linux / macOS",
    "",
    "# Créer la base et les données de démonstration",
    "python seed.py",
    "",
    "# Démarrer le serveur",
    "python run.py",
], titre="Terminal 1 — backend")

H += encart(
    "Le backend est prêt quand…",
    "le terminal affiche <font face='Courier'>Running on http://0.0.0.0:5000</font>. "
    "Vérifiez en ouvrant <font face='Courier'>http://localhost:5000/health</font> dans "
    "un navigateur : la page doit afficher <font face='Courier'>{\"status\": \"ok\"}</font>.",
    ton="ok",
)

H.append(Paragraph("Étape 3 — Démarrer le frontend (terminal n° 2)", S["h3"]))
H += bloc_code([
    "cd frontend",
    "npm install",
    "npm run dev",
], titre="Terminal 2 — frontend")

H += encart(
    "L'application est accessible",
    "sur <font face='Courier'><b>http://localhost:5173</b></font>. "
    "Aucune configuration n'est nécessaire côté frontend en local : les appels vers "
    "<font face='Courier'>/api</font> sont automatiquement relayés vers le backend.",
    ton="ok",
)


H.append(Paragraph("Comptes de démonstration", S["h2"]))
H.append(Paragraph(
    "La commande <font face='Courier'>python seed.py</font> a créé six comptes couvrant "
    "tous les rôles et tous les niveaux de confiance. Le mot de passe est le même pour "
    "tous : <b>tcheyna2026</b>", S["p"]))

H += tableau(
    ["Adresse e-mail", "Rôle", "Particularité"],
    [
        ["admin@tcheyna.test", "Administrateur", "Accès au back-office de vérification"],
        ["aminata@tcheyna.test", "Locataire", "Niveau 3 — dossier complet et solvable"],
        ["mamadou.t@tcheyna.test", "Locataire", "Niveau 2 — identité vérifiée"],
        ["fatoumata@tcheyna.test", "Locataire", "Niveau 1 — téléphone vérifié"],
        ["ibrahima@tcheyna.test", "Propriétaire", "3 annonces dont 2 certifiées"],
        ["mariama@tcheyna.test", "Propriétaire", "2 annonces, 1 en attente de certification"],
    ],
    [52 * mm, 26 * mm, LARGEUR_UTILE - 52 * mm - 26 * mm],
    styles_colonnes=["cellule_code", "cellule", "cellule"],
)

H += encart(
    "Parcours conseillé pour une démonstration",
    "Connectez-vous en <b>ibrahima</b> pour voir les candidatures reçues et accepter un "
    "dossier — la messagerie s'ouvre alors automatiquement. Puis passez en <b>aminata</b> "
    "pour découvrir les annonces recommandées avec leur score de compatibilité. "
    "Terminez en <b>admin</b> pour certifier une annonce en attente.",
)

H.append(Paragraph("Réinitialiser les données", S["h3"]))
H.append(Paragraph(
    "Relancer <font face='Courier'>python seed.py</font> efface les données de "
    "démonstration et les recrée à l'identique. Les comptes créés manuellement pendant "
    "vos essais ne sont pas conservés.", S["p"]))

H.append(PageBreak())

# ─── 4. Production ───────────────────────────────────────────
H += titre_section("4", "Mettre en production")
H.append(Paragraph(
    "La mise en ligne repose sur deux services gratuits : <b>Supabase</b> pour la base "
    "de données PostgreSQL, et <b>Render</b> pour héberger les deux applications. "
    "Comptez une trentaine de minutes la première fois.", S["p"]))

H.append(Paragraph("Étape 1 — Créer la base de données sur Supabase", S["h3"]))
H += puces([
    "Créez un compte sur <b>supabase.com</b>, puis un nouveau projet.",
    "Choisissez un mot de passe de base de données et <b>conservez-le</b> : il n'est plus "
    "affiché ensuite.",
    "Ouvrez <i>Settings → Database → Connection string → URI</i> et copiez l'adresse "
    "obtenue. Elle commence par <font face='Courier'>postgresql://</font>",
])
H.append(Spacer(1, 6))

H.append(Paragraph("Étape 2 — Déployer sur Render", S["h3"]))
H += puces([
    "Poussez le projet sur GitHub s'il ne l'est pas déjà.",
    "Sur <b>render.com</b>, choisissez <i>New → Blueprint</i> et sélectionnez le dépôt.",
    "Render lit le fichier <font face='Courier'>render.yaml</font> à la racine et crée "
    "automatiquement les deux services : l'API et le site web.",
])
H.append(Spacer(1, 6))

H.append(Paragraph("Étape 3 — Renseigner les variables secrètes", S["h3"]))
H.append(Paragraph(
    "Dans le tableau de bord du service <b>tcheyna-api</b>, onglet <i>Environment</i>, "
    "complétez les valeurs suivantes. Les autres variables sont déjà définies par "
    "<font face='Courier'>render.yaml</font>.", S["p"]))

H += tableau(
    ["Variable", "Valeur à saisir", "Obligatoire"],
    [
        ["DATABASE_URL", "L'adresse copiée depuis Supabase à l'étape 1", "<b>Oui</b>"],
        ["CORS_ORIGINS", "L'adresse publique du frontend, par exemple<br/>"
                         "https://tcheyna.onrender.com", "<b>Oui</b>"],
        ["AT_API_KEY", "Clé Africa's Talking — voir section 5", "Non"],
        ["CINETPAY_API_KEY", "Clé CinetPay — voir section 5", "Non"],
        ["CINETPAY_SITE_ID", "Identifiant de site CinetPay", "Non"],
    ],
    [34 * mm, LARGEUR_UTILE - 34 * mm - 22 * mm, 22 * mm],
    styles_colonnes=["cellule_code", "cellule", "cellule"],
)

H += encart(
    "Point de vigilance",
    "<b>CORS_ORIGINS doit correspondre exactement à l'adresse du frontend</b>, sans barre "
    "oblique finale. Une erreur ici est la cause la plus fréquente d'une interface qui "
    "s'affiche mais reste vide : le navigateur bloque alors tous les appels à l'API.",
    ton="attention",
)

H.append(PageBreak())

H.append(Paragraph("Étape 4 — Créer les tables et le compte administrateur", S["h2"]))
H.append(Paragraph(
    "Une fois l'API déployée, ouvrez le <i>Shell</i> du service <b>tcheyna-api</b> depuis "
    "le tableau de bord Render, puis exécutez :", S["p"]))

H += bloc_code([
    "# Créer les tables dans la base Supabase",
    "flask init-db",
    "",
    "# Créer votre compte administrateur",
    "python create_admin.py",
], titre="Shell Render — tcheyna-api")

H.append(Paragraph(
    "Le script demande une adresse e-mail, un nom et un mot de passe. Ce compte donne "
    "accès au back-office : validation des pièces d'identité, des justificatifs de "
    "revenus et certification des annonces.", S["p"]))

H += encart(
    "Ne pas exécuter seed.py en production",
    "Ce script <b>efface les données existantes</b> avant de créer les comptes de "
    "démonstration. Il est réservé au développement local.",
    ton="attention",
)

H.append(Paragraph("Le stockage des documents", S["h3"]))
H.append(Paragraph(
    "Le fichier <font face='Courier'>render.yaml</font> déclare un disque persistant "
    "monté sur <font face='Courier'>/var/data</font>. Les pièces d'identité et "
    "justificatifs téléversés par les utilisateurs y sont conservés et survivent aux "
    "redéploiements. Sans ce disque, ces documents seraient perdus à chaque mise à jour "
    "du code.", S["p"]))

H.append(Paragraph("Mettre à jour l'application", S["h3"]))
H.append(Paragraph(
    "Render surveille la branche <font face='Courier'>main</font>. Chaque "
    "<font face='Courier'>git push</font> déclenche automatiquement un nouveau "
    "déploiement des deux services. Aucune action manuelle n'est nécessaire.", S["p"]))

H.append(PageBreak())

# ─── 5. Services tiers ───────────────────────────────────────
H += titre_section("5", "Activer les services tiers")
H.append(Paragraph(
    "Deux intégrations donnent au produit ses fonctions clés : la vérification par SMS "
    "et le paiement Mobile Money. <b>Elles sont facultatives</b> — l'application "
    "fonctionne sans elles, avec le comportement de repli décrit ci-dessous.", S["p"]))

H += tableau(
    ["Service", "Ce qu'il apporte", "Comportement sans la clé"],
    [
        ["<b>Africa's Talking</b><br/><font color='#94A3B8' size='7.5'>africastalking.com</font>",
         "Envoi du code de vérification par SMS, qui fait passer un utilisateur au "
         "niveau 1 du Passeport Locataire.",
         "Le code est renvoyé directement dans la réponse de l'API en mode "
         "développement. Le parcours reste testable de bout en bout."],
        ["<b>CinetPay</b><br/><font color='#94A3B8' size='7.5'>cinetpay.com</font>",
         "Paiement par Orange Money et MTN MoMo pour la caution, le premier loyer "
         "et les services Tcheyna.",
         "Le paiement est enregistré au statut « en attente » au lieu d'échouer. "
         "Le reste du parcours se poursuit normalement."],
    ],
    [34 * mm, (LARGEUR_UTILE - 34 * mm) / 2, (LARGEUR_UTILE - 34 * mm) / 2],
)

H.append(Paragraph("Obtenir les clés", S["h3"]))
H += puces([
    "<b>Africa's Talking</b> — créez un compte, puis relevez la clé d'API dans "
    "<i>Settings → API Key</i>. Le mode « sandbox » permet de tester sans frais avant "
    "de passer en production.",
    "<b>CinetPay</b> — créez un compte marchand ; la clé d'API et l'identifiant de site "
    "figurent dans le tableau de bord, section <i>Intégration</i>.",
])
H.append(Spacer(1, 6))

H.append(Paragraph("Renseigner les clés", S["h3"]))
H.append(Paragraph(
    "<b>En local</b>, dans le fichier <font face='Courier'>backend/.env</font>. "
    "<b>En production</b>, dans l'onglet <i>Environment</i> du service tcheyna-api "
    "sur Render.", S["p"]))

H += bloc_code([
    "AT_API_KEY=votre_cle_africas_talking",
    "AT_USERNAME=sandbox",
    "AT_SENDER_ID=TCHEYNA",
    "",
    "CINETPAY_API_KEY=votre_cle_cinetpay",
    "CINETPAY_SITE_ID=votre_identifiant_de_site",
], titre="backend/.env")

H += encart(
    "Sécurité des paiements",
    "Les montants sont <b>toujours calculés par le serveur</b> : le client ne choisit "
    "jamais combien il paie. De même, les notifications de paiement envoyées par "
    "CinetPay ne sont pas prises pour argent comptant — le statut réel est revérifié "
    "auprès de CinetPay avant d'être appliqué.",
)


# ─── 6. Vérifications ────────────────────────────────────────
H += titre_section("6", "Vérifier que tout fonctionne")
H.append(Paragraph(
    "Après une installation ou un déploiement, ces quatre contrôles confirment que "
    "l'ensemble de la chaîne est opérationnel.", S["p"]))

H += tableau(
    ["", "Contrôle", "Résultat attendu"],
    [
        ["<b>1</b>", "Ouvrir <font face='Courier'>/health</font> sur l'API",
         "La page affiche <font face='Courier'>{\"status\": \"ok\"}</font>"],
        ["<b>2</b>", "Ouvrir la page d'accueil du frontend",
         "La page se charge, sans zone vide ni message d'erreur"],
        ["<b>3</b>", "Se connecter avec un compte",
         "L'arrivée sur le tableau de bord se fait sans erreur"],
        ["<b>4</b>", "Consulter la liste des annonces",
         "Les annonces s'affichent avec leur prix en GNF"],
    ],
    [8 * mm, 62 * mm, LARGEUR_UTILE - 8 * mm - 62 * mm],
)

H.append(Paragraph("Contrôles techniques", S["h3"]))
H += bloc_code([
    "# Le code frontend est-il cohérent ?",
    "cd frontend && npm run typecheck",
    "",
    "# Le frontend se construit-il pour la production ?",
    "cd frontend && npm run build",
    "",
    "# L'API répond-elle ?",
    "curl http://localhost:5000/health",
])

H += encart(
    "Une remarque sur Render",
    "L'offre gratuite met le service en veille après quinze minutes sans trafic. "
    "La première visite qui suit peut demander <b>trente à cinquante secondes</b> "
    "le temps du réveil : c'est normal, ce n'est pas une panne. Un service de "
    "surveillance comme UptimeRobot, pointé sur "
    "<font face='Courier'>/health</font>, permet de limiter ces mises en veille.",
)

H.append(PageBreak())

# ─── 7. Dépannage ────────────────────────────────────────────
H += titre_section("7", "Résoudre les problèmes courants")

H += tableau(
    ["Symptôme", "Cause probable", "Correction"],
    [
        ["L'interface s'affiche mais reste vide, sans annonces",
         "Le backend n'est pas démarré, ou CORS_ORIGINS ne correspond pas à l'adresse "
         "du frontend",
         "Vérifier que le backend tourne ; corriger CORS_ORIGINS pour qu'il reproduise "
         "exactement l'adresse du frontend, sans barre oblique finale"],

        ["<font face='Courier'>ModuleNotFoundError</font> au lancement du backend",
         "L'environnement Python n'est pas activé",
         "Réactiver <font face='Courier'>.venv</font>, puis relancer "
         "<font face='Courier'>pip install -r requirements.txt</font>"],

        ["Le code SMS n'arrive pas",
         "Aucune clé Africa's Talking n'est configurée",
         "Comportement normal : en développement, le code est renvoyé directement "
         "à l'écran par l'API"],

        ["Le paiement reste « en attente »",
         "Aucune clé CinetPay n'est configurée",
         "Comportement normal en développement. En production, vérifier la clé et "
         "l'adresse de notification"],

        ["Le port 5000 est déjà utilisé",
         "Une autre application occupe ce port",
         "Fermer l'application concernée, ou définir un autre port via la variable "
         "<font face='Courier'>PORT</font>"],

        ["Rechargement d'une page interne : erreur 404 en production",
         "Le service statique ne redirige pas vers index.html",
         "Vérifier que la règle de réécriture est bien présente dans "
         "<font face='Courier'>render.yaml</font>"],
    ],
    [40 * mm, 44 * mm, LARGEUR_UTILE - 40 * mm - 44 * mm],
)


# ─── 8. Aide-mémoire ─────────────────────────────────────────
H += titre_section("8", "Aide-mémoire des commandes")

H.append(Paragraph("Backend", S["h3"]))
H += bloc_code([
    "cd backend",
    ".venv\\Scripts\\activate            # Windows",
    "source .venv/bin/activate          # Linux / macOS",
    "",
    "pip install -r requirements.txt    # Installer les dépendances",
    "python seed.py                     # Réinitialiser les données de démo",
    "python create_admin.py             # Créer un administrateur",
    "python run.py                      # Démarrer le serveur",
    "flask init-db                      # Créer les tables sans données",
])

H.append(Paragraph("Frontend", S["h3"]))
H += bloc_code([
    "cd frontend",
    "npm install                        # Installer les dépendances",
    "npm run dev                        # Démarrer en développement",
    "npm run typecheck                  # Vérifier le code",
    "npm run build                      # Construire pour la production",
    "npm run preview                    # Prévisualiser la version construite",
])

H.append(Paragraph("Adresses utiles", S["h3"]))
H += tableau(
    ["Environnement", "Frontend", "API"],
    [
        ["<b>Local</b>", "localhost:5173", "localhost:5000"],
        ["<b>Production</b>", "tcheyna.onrender.com", "tcheyna-api.onrender.com"],
    ],
    [30 * mm, (LARGEUR_UTILE - 30 * mm) / 2, (LARGEUR_UTILE - 30 * mm) / 2],
    styles_colonnes=["cellule", "cellule_code", "cellule_code"],
)

H.append(Spacer(1, 4))
H += encart(
    "Pour aller plus loin",
    "Le fichier <font face='Courier'>README.md</font>, à la racine du projet, détaille "
    "l'architecture technique : système de confiance à quatre niveaux, fonctionnement "
    "du moteur de matching, liste complète des points d'entrée de l'API et modèle "
    "économique.",
)

H.append(Spacer(1, 14))
filet_fin = Table([[""]], colWidths=[LARGEUR_UTILE], rowHeights=[1.4])
filet_fin.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), ORANGE),
    ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
]))
H.append(filet_fin)
H.append(Spacer(1, 8))
H.append(Paragraph(
    "<b>Tcheyna</b> — La location immobilière, en toute confiance<br/>"
    "<font color='#94A3B8' size='8'>Conakry, République de Guinée · "
    "Jean Faya Kamano, fondateur · jeafatkamano123@gmail.com</font>",
    ParagraphStyle("fin", parent=S["p"], alignment=TA_CENTER, textColor=NUIT)))

doc.build(H)

for avertissement in AVERTISSEMENTS:
    print("  ATTENTION :", avertissement)
print(f"PDF genere : {SORTIE}")
