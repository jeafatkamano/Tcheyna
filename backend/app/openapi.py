"""
app/openapi.py — Spécification OpenAPI de l'API, générée depuis le code (lot 3.10).

Rien n'est écrit à la main : la spécification se déduit
  • des routes Flask (`app.url_map`) : chemins, méthodes, paramètres ;
  • de `role_required` : route authentifiée et rôles admis (et de
    l'attribut `jeton_refresh` pour POST /api/auth/refresh,
    `jeton_acces_ou_refresh` pour POST /api/auth/logout) ;
  • de `valider_corps` : schéma Pydantic du corps de requête ;
  • de app/schemas/reponses.py : les objets que l'API renvoie.

Elle est écrite dans `backend/openapi.json` par `flask api spec`, et le
frontend en génère ses types (`npm run api:types`). Un test vérifie que le
fichier versionné est à jour : une route ou un schéma modifié sans
régénération fait échouer la CI.

Les réponses de chaque route ne sont pas encore décrites une à une : la
spécification publie les objets (composants) et les erreurs. Décrire le
corps de succès de chaque route est l'étape suivante.
"""
import json
import re
from pathlib import Path

import click
from flask import Flask
from flask.cli import AppGroup
from pydantic.json_schema import GenerateJsonSchema

from app.schemas import reponses

FICHIER_SPEC = Path(__file__).resolve().parent.parent / "openapi.json"
REF = "#/components/schemas/{model}"

# Routes hors API publique : fichiers servis en développement seulement.
ENDPOINTS_IGNORES = {"static", "uploaded_file"}
# Routes internes (lot 1.25, tâches nocturnes appelées par cron-job.org) :
# protégées par un jeton propre, jamais appelées par le site.
PREFIXES_IGNORES = ("/api/interne/",)

_PARAM = re.compile(r"<(?:(?P<conv>[a-z]+):)?(?P<nom>\w+)>")
_TYPES_PARAM = {"int": "integer", "float": "number"}


class SansTitresDeChamps(GenerateJsonSchema):
    """Pas de `title` par champ (« Prix » pour `prix`) : du bruit dans les types
    générés. Les titres et docstrings des modèles restent."""

    def field_title_should_be_set(self, schema) -> bool:
        return False


class CollisionDeSchema(RuntimeError):
    """Deux schémas différents portent le même nom de composant."""


# Réponses d'erreur partagées par toutes les routes (corps `Erreur`).
REPONSES_ERREUR = {
    "NonAuthentifie": "Jeton absent, invalide ou expiré",
    "Interdit": "Compte désactivé, rôle non admis ou ressource d'un autre utilisateur",
    "Introuvable": "Ressource introuvable",
    "CorpsInvalide": "Corps de requête invalide (champ par champ dans `details`)",
}


def _erreur(nom: str) -> dict:
    return {"$ref": f"#/components/responses/{nom}"}


def _ajouter_schema(composants: dict, modele, origine: dict) -> dict:
    """Ajoute `modele` et ses sous-modèles aux composants ; renvoie sa référence."""
    schema = modele.model_json_schema(ref_template=REF, schema_generator=SansTitresDeChamps)
    for nom, sous_schema in {**schema.pop("$defs", {}), modele.__name__: schema}.items():
        existant = composants.get(nom)
        if existant is not None and existant != sous_schema:
            raise CollisionDeSchema(
                f"Deux schémas s'appellent « {nom} » ({origine[nom]} et "
                f"{modele.__module__}) : renommer l'une des classes."
            )
        composants[nom] = sous_schema
        origine.setdefault(nom, modele.__module__)
    return {"$ref": REF.format(model=modele.__name__)}


def _operation(vue, endpoint: str, parametres: list, composants: dict, origine: dict) -> dict:
    doc = (vue.__doc__ or "").strip()
    operation = {
        "operationId": endpoint.replace(".", "_"),
        "tags": [endpoint.split(".")[0]] if "." in endpoint else ["application"],
        "summary": doc.splitlines()[0].rstrip(".") if doc else endpoint,
        "responses": {"2XX": {"description": "Succès"}},
    }
    if parametres:
        operation["parameters"] = parametres
        operation["responses"]["404"] = _erreur("Introuvable")

    roles = getattr(vue, "roles_requis", None)
    if roles is not None:
        operation["security"] = [{"jwt": []}]
        operation["responses"]["401"] = _erreur("NonAuthentifie")
        operation["responses"]["403"] = _erreur("Interdit")
        if roles:
            operation["x-roles"] = list(roles)

    if getattr(vue, "jeton_refresh", False):
        operation["security"] = [{"jwtRefresh": []}]
        operation["responses"]["401"] = _erreur("NonAuthentifie")
        operation["responses"]["403"] = _erreur("Interdit")

    # POST /api/auth/logout : jeton d'accès ou de rafraîchissement, au choix.
    if getattr(vue, "jeton_acces_ou_refresh", False):
        operation["security"] = [{"jwt": []}, {"jwtRefresh": []}]
        operation["responses"]["401"] = _erreur("NonAuthentifie")

    schema = getattr(vue, "schema_corps", None)
    if schema is not None:
        ref = _ajouter_schema(composants, schema, origine)
        types = ["application/json"]
        if getattr(vue, "source_corps", "json") == "json_ou_form":
            types.append("application/x-www-form-urlencoded")
        operation["requestBody"] = {
            "required": True,
            "content": {t: {"schema": ref} for t in types},
        }
        operation["responses"]["422"] = _erreur("CorpsInvalide")
    return operation


def construire_spec(app: Flask) -> dict:
    """La spécification OpenAPI 3.1 de `app`, sous forme de dictionnaire."""
    composants: dict = {}
    origine: dict = {}
    for modele in reponses.COMPOSANTS:
        _ajouter_schema(composants, modele, origine)

    chemins: dict = {}
    for regle in sorted(app.url_map.iter_rules(), key=lambda r: r.rule):
        if regle.endpoint in ENDPOINTS_IGNORES or regle.rule.startswith(PREFIXES_IGNORES):
            continue
        parametres = [
            {
                "name": p["nom"],
                "in": "path",
                "required": True,
                "schema": {"type": _TYPES_PARAM.get(p["conv"], "string")},
            }
            for p in _PARAM.finditer(regle.rule)
        ]
        chemin = _PARAM.sub(r"{\g<nom>}", regle.rule)
        vue = app.view_functions[regle.endpoint]
        for methode in sorted(regle.methods - {"HEAD", "OPTIONS"}):
            chemins.setdefault(chemin, {})[methode.lower()] = _operation(
                vue, regle.endpoint, parametres, composants, origine
            )

    return {
        "openapi": "3.1.0",
        "info": {
            "title": "API Tcheyna",
            "version": "1.0.0",
            "description": "Générée par `flask api spec` depuis backend/app. Ne pas modifier à la main.",
        },
        "paths": chemins,
        "components": {
            "schemas": dict(sorted(composants.items())),
            "responses": {
                nom: {
                    "description": description,
                    "content": {"application/json": {"schema": {"$ref": REF.format(model="Erreur")}}},
                }
                for nom, description in REPONSES_ERREUR.items()
            },
            "securitySchemes": {
                "jwt": {"type": "http", "scheme": "bearer", "bearerFormat": "JWT",
                        "description": "Jeton d'accès (`access_token`)."},
                "jwtRefresh": {"type": "http", "scheme": "bearer", "bearerFormat": "JWT",
                               "description": "Jeton de rafraîchissement (`refresh_token`)."},
            },
        },
    }


def spec_en_texte(app: Flask) -> str:
    return json.dumps(construire_spec(app), indent=2, ensure_ascii=False) + "\n"


api_cli = AppGroup("api", help="Contrat de l'API (spécification OpenAPI).")


@api_cli.command("spec")
@click.option("--check", is_flag=True, help="Échoue si backend/openapi.json n'est pas à jour.")
def ecrire_spec(check: bool):
    """Écrit backend/openapi.json depuis les routes et les schémas."""
    from flask import current_app

    texte = spec_en_texte(current_app)
    if check:
        if not FICHIER_SPEC.exists() or FICHIER_SPEC.read_text(encoding="utf-8") != texte:
            raise click.ClickException("backend/openapi.json n'est pas à jour : lancer `flask api spec`.")
        click.echo("backend/openapi.json est à jour.")
        return
    FICHIER_SPEC.write_text(texte, encoding="utf-8")
    click.echo(f"{FICHIER_SPEC.name} écrit ({len(construire_spec(current_app)['paths'])} chemins).")
