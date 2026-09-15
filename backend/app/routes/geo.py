"""
routes/geo.py — Référentiel géographique et devises.

Le marché initial est Conakry : ses cinq communes sont détaillées par quartier,
les autres villes restent au niveau de la commune tant qu'elles ne sont pas
ouvertes commercialement.
"""
from flask import Blueprint, jsonify

geo_bp = Blueprint("geo", __name__)

LOCATIONS = {
    "Guinée": {
        "Conakry": [
            # Kaloum
            "Kaloum Centre", "Almamya", "Sandervalia", "Boulbinet", "Coronthie",
            # Dixinn
            "Dixinn", "Bellevue", "Camayenne", "Landreah", "Hafia",
            # Ratoma
            "Ratoma", "Kipé", "Nongo", "Taouyah", "Lambanyi", "Sonfonia", "Kaporo",
            "Cité de l'Air", "Koloma", "Hamdallaye",
            # Matam
            "Matam", "Bonfi", "Madina", "Coléah", "Boussoura",
            # Matoto
            "Matoto", "Gbessia", "Dabompa", "Simbaya", "Kissosso", "Yimbaya", "Tombolia",
        ],
        "Kindia": ["Centre-ville", "Gbèssia", "Kouria", "Manquepas", "Damakania"],
        "Kankan": ["Centre", "Kabada", "Timbo", "Missira", "Salamani"],
        "Labé":   ["Centre", "Kouroula", "Daka", "Pounthioun"],
        "Nzérékoré": ["Centre", "Belle-Vue", "Horoya", "Dorota"],
        "Boké":   ["Centre", "Kamsar", "Sangarédi"],
    },
    "Sénégal": {
        "Dakar":       ["Plateau", "Médina", "Almadies", "Ouakam", "Parcelles Assainies",
                        "Yoff", "Ngor", "Point E", "Mermoz", "Sacré-Cœur"],
        "Thiès":       ["Centre", "Mbambara", "Randoulène", "Grand Standing"],
        "Saint-Louis": ["Île", "Sor", "Bango", "Guet Ndar"],
    },
    "Côte d'Ivoire": {
        "Abidjan":      ["Cocody", "Plateau", "Yopougon", "Marcory", "Treichville",
                         "Riviera", "Angré", "Deux Plateaux", "Koumassi", "Abobo"],
        "Yamoussoukro": ["Centre", "Habitat", "Zone industrielle", "Kokrenou"],
        "Bouaké":       ["Air France", "Commerce", "Koko", "Belleville"],
    },
    "Ghana": {
        "Accra":  ["East Legon", "Cantonments", "Tema", "Osu", "Airport Residential",
                   "Dansoman", "Achimota", "Spintex"],
        "Kumasi": ["Adum", "Asokwa", "Bantama", "Ahodwo"],
        "Tamale": ["Sakasaka", "Kalpohin", "Nyohini"],
    },
    "Nigeria": {
        "Lagos":         ["Victoria Island", "Ikoyi", "Lekki", "Surulere", "Ikeja",
                          "Yaba", "Gbagada", "Ajah"],
        "Abuja":         ["Maitama", "Garki", "Wuse", "Asokoro", "Gwarinpa", "Jabi"],
        "Port Harcourt": ["GRA", "Diobu", "Rumuola", "Trans Amadi"],
    },
}

CURRENCIES = {
    "Guinée":        {"code": "GNF", "symbol": "GNF",  "locale": "fr-GN"},
    "Sénégal":       {"code": "XOF", "symbol": "FCFA", "locale": "fr-SN"},
    "Côte d'Ivoire": {"code": "XOF", "symbol": "FCFA", "locale": "fr-CI"},
    "Ghana":         {"code": "GHS", "symbol": "GH₵",  "locale": "en-GH"},
    "Nigeria":       {"code": "NGN", "symbol": "₦",    "locale": "en-NG"},
}

# Marchés effectivement ouverts. Les autres restent visibles dans le
# référentiel mais ne sont pas proposés à la publication d'annonces.
MARCHES_OUVERTS = ("Guinée",)

# `sans_pieces` : le frontend masque alors pièces, étage et ameublement, qui
# n'ont pas de sens pour un terrain nu ou un hangar.
TYPES_BIEN = [
    {"valeur": "studio",      "label": "Studio",      "sans_pieces": False},
    {"valeur": "chambre",     "label": "Chambre",     "sans_pieces": False},
    {"valeur": "appartement", "label": "Appartement", "sans_pieces": False},
    {"valeur": "maison",      "label": "Maison",      "sans_pieces": False},
    {"valeur": "villa",       "label": "Villa",       "sans_pieces": False},
    {"valeur": "hangar",      "label": "Hangar",      "sans_pieces": True},
    {"valeur": "terrain",     "label": "Terrain",     "sans_pieces": True},
]


@geo_bp.route("/pays", methods=["GET"])
def get_pays():
    return jsonify({
        "pays": [
            {
                "nom": pays,
                "devise": CURRENCIES.get(pays, {}),
                "ouvert": pays in MARCHES_OUVERTS,
                "nb_villes": len(villes),
            }
            for pays, villes in LOCATIONS.items()
        ]
    }), 200


@geo_bp.route("/villes/<string:pays>", methods=["GET"])
def get_villes(pays):
    villes = LOCATIONS.get(pays)
    if not villes:
        return jsonify({"error": "Pays non trouvé"}), 404
    return jsonify({"pays": pays, "villes": list(villes.keys())}), 200


@geo_bp.route("/quartiers/<string:pays>/<string:ville>", methods=["GET"])
def get_quartiers(pays, ville):
    villes = LOCATIONS.get(pays)
    if not villes:
        return jsonify({"error": "Pays non trouvé"}), 404
    quartiers = villes.get(ville)
    if quartiers is None:
        return jsonify({"error": "Ville non trouvée"}), 404
    return jsonify({"pays": pays, "ville": ville, "quartiers": quartiers}), 200


@geo_bp.route("/referentiel", methods=["GET"])
def referentiel():
    """Tout le référentiel en une requête — évite au frontend d'enchaîner
    trois appels lors de l'onboarding."""
    return jsonify({
        "locations":  LOCATIONS,
        "devises":    CURRENCIES,
        "types_bien": TYPES_BIEN,
        "marches_ouverts": list(MARCHES_OUVERTS),
    }), 200
