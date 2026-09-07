"""
services/matching.py — Score de compatibilité locataire ↔ annonce

Le business plan décrit la mise en relation « selon le budget, la localisation,
le type de bien et le niveau de confiance recherché ». Ce module traduit ces
quatre axes en un score sur 100, utilisé pour :
  • classer les annonces recommandées à un locataire ;
  • classer les candidats suggérés à un propriétaire.

Le score est volontairement lisible plutôt que malin : chaque critère apporte un
nombre de points fixe, et `details` explique la note à l'utilisateur.
"""

# Pondération des critères (total = 100)
POIDS = {
    "budget":     35,
    "localisation": 25,
    "type_bien":  15,
    "confiance":  15,
    "pieces":     10,
}


def score_compatibilite(passport, listing, tenant=None):
    """Retourne (score:int, details:list[dict]) pour un couple passeport/annonce.

    `passport` peut être None : on renvoie alors un score neutre fondé sur la
    seule confiance, pour ne pas pénaliser un locataire qui vient de s'inscrire.
    """
    tenant = tenant or (passport.tenant if passport else None)
    details = []
    score = 0

    # ─── Budget ─────────────────────────────────────────────
    cout = (listing.prix or 0) + (listing.charges or 0)
    budget_max = passport.budget_max if passport else None
    if not budget_max:
        pts = POIDS["budget"] // 2          # inconnu : demi-note, pas d'exclusion
        libelle = "Budget non renseigné"
    elif cout <= budget_max:
        marge = (budget_max - cout) / budget_max
        # Pile dans le budget vaut mieux que très en dessous (bien sous-dimensionné)
        pts = POIDS["budget"] if marge <= 0.30 else int(POIDS["budget"] * 0.85)
        libelle = "Dans le budget"
    elif cout <= budget_max * 1.15:
        pts = int(POIDS["budget"] * 0.5)
        libelle = "Légèrement au-dessus du budget"
    else:
        pts = 0
        libelle = "Au-dessus du budget"
    score += pts
    details.append({"critere": "Budget", "points": pts, "max": POIDS["budget"], "libelle": libelle})

    # ─── Localisation ───────────────────────────────────────
    ville_ok = bool(passport and passport.ville_souhaitee
                    and passport.ville_souhaitee.lower() == (listing.ville or "").lower())
    quartiers = passport.quartiers_list if passport else []
    quartier_ok = bool(quartiers and listing.quartier
                       and listing.quartier.lower() in [q.lower() for q in quartiers])

    if quartier_ok:
        pts, libelle = POIDS["localisation"], "Quartier recherché"
    elif ville_ok:
        pts, libelle = int(POIDS["localisation"] * 0.7), "Bonne ville"
    elif not passport or not passport.ville_souhaitee:
        pts, libelle = POIDS["localisation"] // 2, "Zone non renseignée"
    else:
        pts, libelle = 0, "Hors zone recherchée"
    score += pts
    details.append({"critere": "Localisation", "points": pts,
                    "max": POIDS["localisation"], "libelle": libelle})

    # ─── Type de bien ───────────────────────────────────────
    souhaite = passport.type_bien_souhaite if passport else None
    if not souhaite:
        pts, libelle = POIDS["type_bien"] // 2, "Type non renseigné"
    elif souhaite.lower() == (listing.type_bien or "").lower():
        pts, libelle = POIDS["type_bien"], "Type de bien recherché"
    else:
        pts, libelle = 0, "Autre type de bien"
    score += pts
    details.append({"critere": "Type de bien", "points": pts,
                    "max": POIDS["type_bien"], "libelle": libelle})

    # ─── Nombre de pièces ───────────────────────────────────
    mini = passport.nb_pieces_min if passport else None
    if not mini:
        pts, libelle = POIDS["pieces"] // 2, "Non renseigné"
    elif (listing.nb_pieces or 0) >= mini:
        pts, libelle = POIDS["pieces"], f"{listing.nb_pieces} pièces"
    else:
        pts, libelle = 0, "Trop petit"
    score += pts
    details.append({"critere": "Pièces", "points": pts,
                    "max": POIDS["pieces"], "libelle": libelle})

    # ─── Confiance ──────────────────────────────────────────
    # Une annonce certifiée face à un locataire vérifié : le cœur de Tcheyna.
    niveau = (tenant.trust_level or 0) if tenant else 0
    pts = int(POIDS["confiance"] * (0.5 * min(niveau, 4) / 4))
    libelle_conf = []
    if niveau:
        libelle_conf.append(f"Locataire niveau {niveau}")
    if listing.is_certified:
        pts += int(POIDS["confiance"] * 0.5)
        libelle_conf.append("Annonce certifiée")
    score += pts
    details.append({"critere": "Confiance", "points": pts, "max": POIDS["confiance"],
                    "libelle": " · ".join(libelle_conf) or "À vérifier"})

    return min(score, 100), details


def trier_par_compatibilite(passport, listings, tenant=None):
    """Trie des annonces par score décroissant.

    Les annonces certifiées et les annonces premium remontent à score égal —
    c'est la contrepartie promise aux propriétaires qui paient la certification
    et la mise en avant.
    """
    scores = []
    for listing in listings:
        score, details = score_compatibilite(passport, listing, tenant)
        scores.append((listing, score, details))

    scores.sort(
        key=lambda t: (t[1], t[0].premium_actif, t[0].is_certified),
        reverse=True,
    )
    return scores
