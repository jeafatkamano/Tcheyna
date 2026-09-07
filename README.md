# Tcheyna

**La location immobilière, en toute confiance.**
Plateforme de mise en relation locative bidirectionnelle pour Conakry (Guinée).

Là où les plateformes classiques ne vérifient que l'annonce, Tcheyna vérifie
**les deux côtés** de la transaction : le locataire construit un *Passeport
Locataire* à quatre niveaux, le propriétaire fait certifier son annonce. C'est
cet actif de confiance — et non la liste d'annonces — qui constitue le produit.

---

## Architecture

```
Tcheyna/
├── backend/            API REST Flask + SQLAlchemy
│   ├── app/
│   │   ├── models.py       Utilisateurs, annonces, matchs, passeports,
│   │   │                   conversations, paiements, avis, notifications
│   │   ├── routes/         Un blueprint par domaine métier
│   │   └── services/       Moteur de matching, notifications
│   ├── config.py
│   ├── run.py              Point d'entrée (gunicorn run:app en production)
│   ├── seed.py             Jeu de données de démonstration
│   └── create_admin.py
│
├── frontend/           Application React 18 + Vite + Tailwind 4
│   └── src/
│       ├── api/            Couche API typée (client, types, endpoints)
│       ├── components/     Layout, badges de confiance, cartes, états
│       ├── context/        Session utilisateur
│       ├── hooks/          useApi / useAction / useGeo
│       ├── lib/            Formatage GNF et dates
│       └── pages/          tenant/ · owner/ · admin/ · shared/
│
├── docs/               Guide d'installation au format PDF et son générateur
└── render.yaml         Déploiement des deux services
```

**Pile technique** — Flask 3 · SQLAlchemy · JWT · PostgreSQL (Supabase) ·
React 18 · React Router 7 · Tailwind CSS 4 · Vite 6.
**Intégrations** — Africa's Talking (OTP SMS) · CinetPay (Mobile Money).

---

## Démarrage local

Deux terminaux : l'API sur le port 5000, le frontend sur le 5173.

### 1. Backend

```bash
cd backend
python -m venv .venv
.venv/Scripts/activate          # Windows  (Linux/macOS : source .venv/bin/activate)
pip install -r requirements.txt

cp .env.example .env            # les valeurs par défaut suffisent en local
python seed.py                  # crée la base SQLite et les données de démo
python run.py                   # → http://localhost:5000
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev                     # → http://localhost:5173
```

Aucune variable d'environnement n'est nécessaire côté frontend en local : Vite
relaie `/api` et `/uploads` vers Flask (voir `vite.config.ts`), ce qui évite
également tout problème de CORS.

### Comptes de démonstration — développement local uniquement

Mot de passe commun : `tcheyna2026`

> `seed.py` **efface toutes les données** avant de recréer ce jeu, et crée un
> administrateur dont le mot de passe figure ci-dessous. Le script refuse donc
> de s'exécuter sur une base distante. La démonstration en ligne utilise des
> comptes distincts (`@tcheyna.demo`), sans compte administrateur et avec un
> autre mot de passe — ceux-ci ne donnent aucun accès à la production.

| Compte | Rôle | Particularité |
|---|---|---|
| `admin@tcheyna.test` | Administrateur | File de vérification |
| `aminata@tcheyna.test` | Locataire | Niveau 3 — dossier complet |
| `mamadou.t@tcheyna.test` | Locataire | Niveau 2 — identité vérifiée |
| `fatoumata@tcheyna.test` | Locataire | Niveau 1 — téléphone vérifié |
| `ibrahima@tcheyna.test` | Propriétaire | 3 annonces, 2 certifiées |
| `mariama@tcheyna.test` | Propriétaire | 2 annonces, 1 en attente |

---

## Le système de confiance

### Passeport Locataire

| Niveau | Critère | Ce que cela débloque |
|---|---|---|
| 1 — Basique | Numéro vérifié par SMS (OTP) | Recherche, candidature et messagerie |
| 2 — Identifié | Pièce d'identité validée | Candidature aux **annonces certifiées** |
| 3 — Solvable | Justificatifs de revenus validés | Mise en avant auprès des propriétaires |
| 4 — Recommandé | 3 avis positifs d'anciens bailleurs | Badge « Locataire de confiance » |

Les niveaux sont **cumulatifs et calculés côté serveur** (`User.update_trust_level`).
Déposer un nouveau document annule la validation précédente : un vérificateur
doit statuer à nouveau.

### Annonce Certifiée

Le propriétaire dépose un document de propriété, l'annonce passe en `pending`,
un administrateur tranche. Une annonce certifiée affiche un badge, remonte dans
les résultats et n'accepte que les candidats de niveau 2 ou plus. Modifier une
caractéristique du bien (adresse, quartier, superficie…) annule la certification.

### Matching

`backend/app/services/matching.py` note chaque couple locataire/annonce sur 100,
selon quatre axes pondérés : budget (35), localisation (25), type de bien (15),
niveau de confiance (15) et nombre de pièces (10). Le score alimente :

- les recommandations du locataire (`GET /api/listings/recommandations`) ;
- les candidats suggérés au propriétaire (`GET /api/matches/candidats-suggeres`).

---

## Modèle économique

| Source | Payeur | Tarif |
|---|---|---|
| Commission de mise en relation | Propriétaire | 6 % du premier loyer |
| Certification d'annonce | Propriétaire | 250 000 GNF |
| Mise en avant (30 jours) | Propriétaire | 200 000 GNF |
| Abonnement Passeport Locataire | Locataire | 150 000 GNF / an |

Les montants sont **toujours calculés côté serveur** : le client ne choisit
jamais combien il paie. Les webhooks CinetPay ne sont pas crus sur parole — le
statut est revérifié auprès de CinetPay avant d'être appliqué.

---

## Principaux points d'entrée de l'API

Toutes les routes sont préfixées par `/api`.

| Domaine | Routes notables |
|---|---|
| `auth` | `register`, `login`, `refresh`, `me`, `send-otp`, `verify-otp`, `niveaux` |
| `listings` | `GET /` (recherche filtrée), `recommandations`, `mes-annonces`, `POST /<id>/certification`, `POST /<id>/document` |
| `matches` | `POST /`, `mes-candidatures`, `mes-demandes`, `candidats-suggeres`, `PUT /<id>/statut`, `PUT /<id>/visite`, `PUT /<id>/conclure` |
| `passport` | `GET /`, `POST /`, `PUT /preferences`, `POST /upload/<type>` |
| `messages` | `conversations`, `par-match/<id>`, `POST /conversations/<id>`, `non-lus` |
| `payments` | `tarifs`, `initier`, `callback`, `mes-paiements`, `GET /<id>` (reçu) |
| `admin` | `stats`, `cni-pending`, `verify-cni/<id>`, `revenus-pending`, `certifications-pending`, `certifier/<id>` |
| `favorites`, `notifications`, `reviews`, `geo`, `users` | — |

Santé du service : `GET /health` (utilisé par Render et UptimeRobot).

---

## Déploiement

`render.yaml` déclare les deux services. Après l'import du dépôt sur Render,
renseigner les secrets marqués `sync: false` :

- `DATABASE_URL` — chaîne de connexion Supabase (`postgresql://…`)
- `AT_API_KEY` — Africa's Talking
- `CINETPAY_API_KEY`, `CINETPAY_SITE_ID` — CinetPay

Puis créer les tables et le compte administrateur :

```bash
flask init-db          # ou : python -c "from run import app,db; app.app_context().push(); db.create_all()"
python create_admin.py
```

Un disque persistant est monté sur `/var/data` : les CNI et justificatifs
téléversés survivent aux redéploiements.

### Comportement sans clés d'API

Le produit reste testable de bout en bout sans compte tiers :

- **sans `AT_API_KEY`** — le code OTP est renvoyé dans la réponse de l'API en
  mode `DEBUG` plutôt qu'envoyé par SMS ;
- **sans `CINETPAY_API_KEY`** — le paiement est enregistré en statut
  `pending` et le parcours continue, au lieu d'échouer.

---

## Vérifications

```bash
cd frontend && npm run typecheck   # TypeScript strict
cd frontend && npm run build       # build de production
```

---

## Documentation

`Tcheyna-Guide-Installation-Deploiement.pdf`, à la racine, reprend ces
procédures sous une forme imprimable, à destination de quelqu'un qui découvre
le projet. Il se régénère depuis `docs/` :

```bash
pip install -r docs/requirements.txt
python docs/generer_guide.py
```

Le guide et ce README couvrent les mêmes étapes : **les faire évoluer ensemble**.

---

Conakry, République de Guinée — Jean Faya Kamano, fondateur.
