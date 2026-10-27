"""
app/schemas — Validation des corps de requête (Pydantic v2).

Avant ce lot, chaque route lisait `request.get_json()` et écrivait les valeurs
telles quelles en base : un texte dans un prix, un `status` arbitraire, une
chaîne trop longue pour sa colonne… finissaient en 500 sur PostgreSQL ou en
données corrompues. Chaque route qui lit un corps déclare désormais son
schéma, et ne reçoit que des valeurs typées et bornées.

Conventions communes à tous les schémas :
  • champ inconnu refusé (`extra="forbid"`) : un champ que la route ignore
    (`status`, `images`…) est signalé au client au lieu d'être perdu ou,
    pire, appliqué ;
  • bornes de longueur = celles des colonnes (`String(n)`) ;
  • nombres en mode souple (« "12" » accepté, utile pour les formulaires),
    mais jamais un booléen là où un nombre est attendu ;
  • caractère NUL refusé dans toute chaîne : PostgreSQL le rejette (500).

Réponse en cas d'erreur : 422 `{"error": <message FR>, "details": [{champ,
code, message}]}`. Le front affiche `error` tel quel ; `details` sert à un
affichage champ par champ et aux clients mobiles (`code` est stable).
"""
from datetime import date, datetime
from functools import wraps
from typing import Annotated

from flask import jsonify, request
from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StringConstraints,
    ValidationError,
)
from pydantic_core import InitErrorDetails, PydanticCustomError
from werkzeug.exceptions import BadRequest

INT32_MAX = 2_147_483_647  # borne des colonnes `Integer` sur PostgreSQL


class BaseCorps(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ─── Types communs ───────────────────────────────────────────

def _sans_nul(valeur):
    if "\x00" in valeur:
        raise PydanticCustomError("caractere_interdit", "Caractère interdit (NUL)")
    return valeur


def Texte(max_len, min_len=0):
    """Chaîne débarrassée de ses espaces de bord, puis bornée : `"   "` ne
    satisfait donc pas un champ requis. `max_length` compte des caractères,
    comme `VARCHAR(n)` sur PostgreSQL."""
    return Annotated[str, StringConstraints(strip_whitespace=True, min_length=min_len,
                                            max_length=max_len), AfterValidator(_sans_nul)]


# Un mot de passe n'est jamais retouché : retirer ses espaces de bord
# empêcherait de se connecter à un compte créé avec.
MotDePasse = Annotated[str, StringConstraints(min_length=8, max_length=128)]
MotDePasseSaisi = Annotated[str, StringConstraints(min_length=1, max_length=1024)]


def _pas_un_booleen(valeur):
    # En mode souple, Pydantic lit `true` comme 1 : un prix à « vrai » n'a pas
    # de sens et trahit un client défectueux.
    if isinstance(valeur, bool):
        raise PydanticCustomError("int_type", "Nombre attendu")
    return valeur


def Entier(ge=0, le=INT32_MAX):
    return Annotated[int, BeforeValidator(_pas_un_booleen), Field(ge=ge, le=le)]


Entier32 = Entier()
# NaN et l'infini passent `json.loads` : sans `allow_inf_nan=False`, ils
# seraient enregistrés tels quels.
Superficie = Annotated[float, BeforeValidator(_pas_un_booleen),
                       Field(gt=0, le=1_000_000, allow_inf_nan=False)]


def _date_en_texte(code):
    # En mode souple, Pydantic accepte un horodatage numérique pour une date :
    # `123` deviendrait le 1er janvier 1970.
    def verifier(valeur):
        if valeur is not None and not isinstance(valeur, (str, date)):
            raise PydanticCustomError(code, "Date attendue")
        # `""` vaut « pas de date » : c'est ce qu'envoie un champ de date vidé.
        return None if valeur == "" else valeur
    return BeforeValidator(verifier)


DateVide = Annotated[date | None, _date_en_texte("date_type")]
DateHeure = Annotated[datetime, _date_en_texte("datetime_type")]


def Choix(valeurs):
    """Valeur prise dans une liste fermée, avec un message qui liste les
    possibilités (le message par défaut de `Literal` est en anglais)."""
    valeurs = tuple(valeurs)

    def verifier(valeur):
        if valeur not in valeurs:
            raise PydanticCustomError("choix_invalide", "Valeur invalide (valeurs possibles : {attendus})",
                                      {"attendus": " | ".join(valeurs)})
        return valeur

    return Annotated[str, StringConstraints(strip_whitespace=True), AfterValidator(verifier),
                     Field(json_schema_extra={"enum": list(valeurs)})]


# ─── Messages en français ────────────────────────────────────

MESSAGES = {
    "missing":                 "Champ requis : {champ}",
    "extra_forbidden":         "Champ non autorisé : {champ}",
    "model_type":              "Le corps de la requête doit être un objet JSON",
    "string_type":             "{champ} : texte attendu",
    "string_too_long":         "{champ} : {max_length} caractères maximum",
    "int_type":                "{champ} : nombre entier attendu",
    "int_parsing":             "{champ} : nombre entier attendu",
    "int_from_float":          "{champ} : nombre entier attendu",
    "float_type":              "{champ} : nombre attendu",
    "float_parsing":           "{champ} : nombre attendu",
    "finite_number":           "{champ} : nombre attendu",
    "bool_type":               "{champ} : vrai ou faux attendu",
    "bool_parsing":            "{champ} : vrai ou faux attendu",
    "greater_than":            "{champ} doit être supérieur à {gt}",
    "greater_than_equal":      "{champ} : {ge} minimum",
    "less_than":               "{champ} doit être inférieur à {lt}",
    "less_than_equal":         "{champ} : {le} maximum",
    "list_type":               "{champ} : liste attendue",
    "too_long":                "{champ} : {max_length} éléments maximum",
    "date_type":               "{champ} : date attendue (AAAA-MM-JJ)",
    "date_parsing":            "{champ} : date attendue (AAAA-MM-JJ)",
    "date_from_datetime_parsing": "{champ} : date attendue (AAAA-MM-JJ)",
    "date_from_datetime_inexact": "{champ} : date attendue (AAAA-MM-JJ)",
    "datetime_type":           "{champ} : date et heure attendues (ex. 2026-09-15T14:30)",
    "datetime_parsing":        "{champ} : date et heure attendues (ex. 2026-09-15T14:30)",
    "datetime_from_date_parsing": "{champ} : date et heure attendues (ex. 2026-09-15T14:30)",
    "choix_invalide":          "{champ} invalide (valeurs possibles : {attendus})",
    "caractere_interdit":      "{champ} contient un caractère interdit",
}


def _message(erreur):
    champ = ".".join(str(p) for p in erreur["loc"]) or "corps"
    code = erreur["type"]
    contexte = erreur.get("ctx") or {}
    if code == "string_too_short":
        gabarit = ("{champ} ne peut pas être vide" if contexte.get("min_length") == 1
                   else "{champ} : {min_length} caractères minimum")
    else:
        gabarit = MESSAGES.get(code)
    if gabarit is None:
        # Erreur propre à un schéma : son message est déjà rédigé en français.
        return champ, erreur["msg"] if code in CODES_LIBRES else f"Champ invalide : {champ}"
    return champ, gabarit.format(champ=champ, **{k: v for k, v in contexte.items() if k != "champ"})


# Codes levés par les schémas (PydanticCustomError) dont le message est
# rédigé pour être affiché tel quel.
CODES_LIBRES = {"email_invalide", "code_invalide", "lieu_invalide", "montant_trop_eleve",
                "devise_incoherente", "budget_incoherent", "mot_de_passe_incorrect",
                "piece_absente", "hors_plateforme", "telephone_invalide", "type_retire",
                "date_passee", "date_trop_lointaine", "devise_non_prise_en_charge"}


def reponse_422(exc):
    details = []
    for erreur in exc.errors(include_url=False):
        champ, message = _message(erreur)
        details.append({"champ": champ if erreur["loc"] else "__root__",
                        "code": erreur["type"], "message": message})
    return jsonify({"error": details[0]["message"], "details": details}), 422


class ErreurValidation(Exception):
    """Refus de validation constaté par une route (contrôle qui dépend de
    l'état en base, comme la ville d'une annonce dont seul le pays change).

    Exception dédiée, et non `ValidationError` : une erreur Pydantic levée
    ailleurs (sérialisation, bug interne) doit rester un 500, pas devenir un
    422 qui la masquerait.
    """

    def __init__(self, validation):
        super().__init__(str(validation))
        self.validation = validation


def erreur_champ(champ, code, message, valeur=None, **contexte):
    """Construit l'`ErreurValidation` d'un champ ; levée, elle produit la
    même réponse 422 qu'un schéma."""
    return ErreurValidation(ValidationError.from_exception_data("corps", [InitErrorDetails(
        type=PydanticCustomError(code, message, contexte or None),
        loc=(champ,), input=valeur,
    )]))


# ─── Décorateur ──────────────────────────────────────────────

def _corps_brut(source):
    """Lit le corps sans jamais laisser Flask répondre en HTML (415/400).
    Retourne `(valeur, None)` ou `(None, réponse d'erreur)`."""
    donnees = request.get_data(cache=True)
    if request.is_json:
        if not donnees.strip():
            return {}, None
        try:
            return request.get_json(), None
        except BadRequest:
            return None, (jsonify({"error": "Corps de requête JSON illisible", "details": []}), 400)
    if source == "json_ou_form" and request.form:
        return request.form.to_dict(), None
    if donnees:
        return None, (jsonify({"error": "Corps de requête illisible : JSON attendu "
                                        "(Content-Type: application/json)", "details": []}), 400)
    # Corps absent : le schéma dira ce qui manque.
    return {}, None


def valider_corps(schema, source="json"):
    """Valide le corps de la requête et le passe à la vue en argument `corps`.

    À placer SOUS `@role_required` / `@current_user_required` : un anonyme
    reçoit 401, pas la description du schéma. `source="json_ou_form"` accepte
    aussi un formulaire (webhook CinetPay).
    """
    def decorateur(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            brut, erreur = _corps_brut(source)
            if erreur:
                return erreur
            try:
                corps = schema.model_validate(brut)
            except ValidationError as exc:
                return reponse_422(exc)
            return fn(*args, corps=corps, **kwargs)
        # Lu par app/openapi.py pour décrire le corps attendu. `wraps` recopie
        # ces attributs sur les décorateurs posés au-dessus (`role_required`).
        wrapper.schema_corps = schema
        wrapper.source_corps = source
        return wrapper
    return decorateur

