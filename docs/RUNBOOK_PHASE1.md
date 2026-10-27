# Mise en production de la phase 1

Pour Kamano. Commandes PowerShell, depuis le poste Windows, dans
`C:\Users\Kamano\Desktop\Desktop\Tcheyna`. Durée : 1 h à 2 h, dont l'essentiel
est la comparaison des schémas (étape 3).

Render déploie `main` automatiquement : **tant que la base de production n'est
pas prête, ne merge rien sur `main`.** L'offre gratuite de Render n'a pas de
shell : tout ce qui touche la base se fait depuis ton poste.

La référence technique reste `backend/migrations/README`. Ce document l'applique
pas à pas ; en cas de doute, c'est le README qui fait foi.

---

## 0. Outils, une seule fois

1. **Version de PostgreSQL de Supabase** : SQL Editor → `select version();`.
   Note la version majeure (15, 16 ou 17).
2. **PostgreSQL pour Windows, même version majeure ou plus récente** : il
   fournit `pg_dump`, `pg_restore`, `psql`, et un serveur local vide pour la
   comparaison de l'étape 3 (sans Docker).

   ```powershell
   winget install PostgreSQL.PostgreSQL.17      # adapte 17 à la version notée
   $env:Path += ";C:\Program Files\PostgreSQL\17\bin"
   pg_dump --version
   ```
   `pg_dump` refuse une base plus récente que lui : sa version doit être ≥ celle
   de Supabase.
3. **Python 3.12 et les dépendances du backend** :

   ```powershell
   cd backend
   py -3.12 -m venv .venv
   .\.venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   cd ..
   ```
4. **Chaîne de connexion de production** : Supabase → Project Settings →
   Database → Connection string → **Session pooler** (port 5432). La connexion
   directe `db.<projet>.supabase.co` est en IPv6 seulement sur l'offre gratuite ;
   le pooler passe en IPv4. Ne colle cette chaîne **que** quand une étape la
   demande, jamais dans un fichier versionné.

## 1. Vérifier les variables Render avant tout merge

Render → service `tcheyna-api` → Environment.

| Variable | Exigence | Si elle manque |
|---|---|---|
| `SECRET_KEY`, `JWT_SECRET_KEY` | ≥ 32 caractères, pas une valeur d'exemple (lot 1.10 : sinon l'API refuse de démarrer) | Générer : `python -c "import secrets; print(secrets.token_urlsafe(48))"`. Changer `JWT_SECRET_KEY` déconnecte tout le monde. |
| `OTP_HMAC_KEY` | Facultatif ; s'il est rempli, ≥ 32 caractères | Laisser vide : il est dérivé de `SECRET_KEY` |
| `DATABASE_URL` | URL PostgreSQL de Supabase | Bloquant |
| `TRUSTED_PROXY_HOPS` | `1` (répartiteur Render) | Défaut du code : 1 |
| `RATELIMIT_STORAGE_URI` | `memory://` tant qu'il n'y a pas de Redis | Défaut du code : `memory://` |
| `CORS_ORIGINS` | URL exacte du site (`https://…onrender.com`, sans `/` final) | Le site ne peut plus appeler l'API |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | Renseignés | Les téléversements sont refusés |
| `CINETPAY_*`, `AT_*` | Renseignés si les paiements et SMS sont réels | Paiements en attente, OTP renvoyé par l'API |

Si le service a été créé par le Blueprint (`render.yaml`), Render a généré les
trois clés ; vérifie seulement qu'elles existent. S'il a été créé à la main,
c'est cette étape qui évite un déploiement qui ne démarre pas.

## 2. Sauvegarde complète

```powershell
$env:PGPROD = Read-Host "Chaîne Session pooler de PRODUCTION"
pg_dump --format=custom --no-owner --no-privileges --schema=public `
        --file="tcheyna_prod_$(Get-Date -Format yyyyMMdd_HHmm).dump" $env:PGPROD
```

Garde le fichier `.dump` hors du dépôt (il contient des données personnelles)
et supprime-le après la phase 1 si tout va bien. Restauration, seulement en
cas de casse (étape 7) :

```powershell
pg_restore --clean --if-exists --no-owner --no-privileges --dbname=$env:PGPROD <fichier>.dump
```

## 3. Comparer le schéma de prod au schéma attendu

La prod a été créée par `db.create_all()`. Une dérive est **probable**
(`listings.type_transaction`, `listings.documents_urls` à la place de
`propriete_doc_url`) : voir la section 1 du README des migrations.

```powershell
# a) Base locale vide, au schéma attendu (révision initiale seulement)
createdb -U postgres tcheyna_compare
cd backend
$env:FLASK_APP = "run.py"; $env:FLASK_ENV = "development"
$env:DATABASE_URL = "postgresql://postgres:<mdp local>@localhost:5432/tcheyna_compare"
flask db upgrade d5a017c5d0f3
cd ..
pg_dump --schema-only --schema=public --no-owner --no-privileges $env:DATABASE_URL |
  Sort-Object | Set-Content attendu.sql
Remove-Item Env:DATABASE_URL

# b) Schéma réel de la prod (lecture seule)
pg_dump --schema-only --schema=public --no-owner --no-privileges $env:PGPROD |
  Sort-Object | Set-Content prod.sql

# c) Différences
git diff --no-index prod.sql attendu.sql
```

Seules doivent différer : la table `alembic_version`, les commentaires, les
lignes `\restrict`. Tout autre écart : corrige **la prod** par les
`ALTER TABLE` du README (après la sauvegarde), puis refais b) et c) jusqu'à un
diff vide. N'écris jamais de nouvelle révision pour ces écarts.

## 4. Tamponner, puis monter la base

Ces révisions sont additives et compatibles avec le code actuellement en
production : on les applique **avant** de déployer le nouveau code.

```powershell
cd backend
$env:FLASK_APP = "run.py"; $env:FLASK_ENV = "production"
$env:DATABASE_URL = $env:PGPROD
# ProductionConfig exige aussi des secrets forts ; pour ces commandes, des
# valeurs jetables suffisent (elles ne signent rien).
$env:SECRET_KEY = python -c "import secrets; print(secrets.token_urlsafe(48))"
$env:JWT_SECRET_KEY = python -c "import secrets; print(secrets.token_urlsafe(48))"

flask db stamp d5a017c5d0f3     # une seule fois, uniquement après un diff vide
flask db upgrade                # applique les 3 révisions ci-dessous
flask db current                # attendu : 694ce1497b2e (head)
flask db check                  # attendu : « No new upgrade operations detected. »

Remove-Item Env:DATABASE_URL, Env:PGPROD, Env:SECRET_KEY, Env:JWT_SECRET_KEY
cd ..
```

| Révision | Lot | Effet | Compatible avec l'ancien code |
|---|---|---|---|
| `3b8e2c41f7a9` | 1.2 | `listings.prix` passe en `BIGINT` | Oui |
| `7c4f1d2e9a6b` | 1.4 | `users.token_version` (défaut 0), `otp_codes.code_hash` et `otp_codes.phone` ajoutées, `otp_codes.code` devient facultatif | Oui |
| `694ce1497b2e` | 1.5 | Tables `verifications` (journal des décisions sur les pièces) et `fichiers_a_supprimer` ; dates de dépôt des pièces | Oui |

Si `flask db check` signale une opération : `flask db stamp base` (ne touche
que `alembic_version`) et retour à l'étape 3.

## 5. Merger, dans cet ordre

Ordre vérifié : chaque étape fusionnée sur la précédente, tests backend et
frontend verts, une seule tête Alembic.

| # | Branche | Contenu | Remarque |
|---|---|---|---|
| 1 | `claude/project-thread-2ollr2` | Phase 1 : lots 1.1, 1.2, 1.4, 1.6, 1.7, 1.3, 1.3b, 1.5 (PR #2 à #8, #11) | Voir ci-dessous |
| 2 | `claude/lot-1.10-secrets-prod` | Secrets forts exigés en production | Étape 1 faite avant |
| 3 | `claude/lot-1.11-runbook-phase1` | Ce document | — |
| 4 | `claude/lot-0.4-subagents` | Subagents de relecture | — |
| 5 | `claude/lot-3.9-deploiement-separe` | Chaque service Render ne se redéploie que si son dossier change | — |
| 6 | `claude/project-thread-2m8yp9` | Backlog, couloirs, règles multi-agents (lot 0.2) | — |
| 7 | `claude/cgu-d2-proposition` | CGU §6 : caution et loyer hors plateforme (lot 1.8) | Relis le texte : c'est un engagement juridique |
| 8 | `claude/tests-windows` | Tests lançables sous Windows | — |
| 9 | `claude/lot-3.1-requetes` | Recherche sans N+1 | — |
| 10 | `claude/lot-3.3-pwa` | Site installable, hors ligne | — |
| 11 | `claude/lot-3.5-images` | Vignettes, `srcset` | — |
| 12 | `claude/apk-android` | Projet Android Capacitor | — |

**Pour la ligne 1, deux façons équivalentes** (même contenu final, historique
linéaire) :

- **Rapide** : avancer `main` d'un coup.
  ```powershell
  git fetch origin
  git switch main
  git merge --ff-only origin/claude/project-thread-2ollr2
  git push origin main
  ```
  Les PR #2 à #8 et #11 qui visent `main` passent seules en « Merged ». Une PR
  qui vise une autre branche de la pile reste ouverte : ferme-la à la main.
- **Une par une** : sur GitHub, merge #2, puis #3, #4, #5, #6, #7, #8, #11, en
  changeant si besoin la base de chaque PR vers `main` (« Edit » à côté du
  titre) avant de la merger.

Ensuite, pour les lignes 2 à 12 : bouton « Merge » de chaque PR, dans l'ordre.
Attends que le déploiement Render de la ligne 1 soit vert (étape 6) avant de
continuer.

## 6. Vérifier après le déploiement

Render → `tcheyna-api` → Events : le déploiement doit être « Live ». S'il
échoue au démarrage avec `RuntimeError`, le message dit quelle variable
corriger (étape 1).

| Contrôle | Attendu |
|---|---|
| `https://<api>.onrender.com/health` | `{"status": "ok", …}` |
| Connexion avec un compte existant | OK. Les anciens jetons restent valides (`token_version` = 0). |
| Inscription → OTP | Code reçu par SMS (ou renvoyé par l'API si `AT_API_KEY` est vide) |
| Recherche d'annonces | Résultats, photos affichées |
| Admin → état de la configuration (`GET /api/admin/diagnostic`) | Stockage « prêt », pas d'alerte sur les clés |
| Initier un paiement `caution` ou `premier_loyer` | Refusé (D2 = A) |
| Téléverser une photo d'annonce | Acceptée, ré-encodée en WebP |

## 7. Retour arrière

1. **Code** : Render → Deploys → déploiement précédent → « Rollback ». Les
   trois révisions étant compatibles avec l'ancien code, **la base n'a pas
   besoin d'être touchée**.
2. **Base**, seulement si elle est abîmée : `pg_restore` de l'étape 2. Tout ce
   qui a été écrit depuis la sauvegarde (comptes, messages, paiements) est
   perdu : note l'heure et préviens les utilisateurs concernés.
3. Ne lance pas `flask db downgrade` en production sans avoir relu la révision :
   un retour en arrière supprime les colonnes ajoutées et leurs données.

## 8. Lot 1.9 : cautions et premiers loyers déjà encaissés ou en attente

Depuis D2 = A, Tcheyna ne détient plus de fonds de tiers. Après le déploiement,
liste ce qui reste en base. Requête **en lecture seule**, dans le SQL Editor de
Supabase :

```sql
SELECT p.reference,
       p.type_paiement,
       p.statut,
       p.montant,
       p.devise,
       p.created_at,
       p.paid_at,
       p.cinetpay_transaction_id,
       u.email,
       u.phone,
       p.match_id
FROM payments AS p
JOIN users AS u ON u.id = p.user_id
WHERE p.type_paiement IN ('caution', 'premier_loyer')
  AND p.statut IN ('pending', 'success', 'a_rembourser')
ORDER BY p.statut, p.created_at;
```

| Statut | Ce que c'est | Action |
|---|---|---|
| `pending` | Initié, jamais confirmé | Cherche `cinetpay_transaction_id` dans le back-office CinetPay. Non payé : rien à faire, la ligne reste sans effet. Payé : rembourse depuis CinetPay et note la référence. Si le payeur clique « Vérifier » sur son paiement, le code le passe lui-même en `a_rembourser` (lot 1.3b) ; seul le payeur peut lancer cette vérification. |
| `a_rembourser` | Encaissé, pas dû | Rembourser depuis le back-office CinetPay, puis Admin → Remboursements → « Remboursé ». |
| `success` | Encaissé avant D2 | **Décision à prendre** : rembourser le locataire, ou reverser au bailleur avec son accord écrit. Dans les deux cas, garder une trace (référence CinetPay, date, destinataire). |

## 9. Réveil du plan gratuit (D9, en attendant ta décision)

Le service gratuit s'endort après 15 minutes sans requête ; le réveil prend
30 à 60 s, long en 3G. En attendant D9 :

- UptimeRobot → New monitor → HTTP(s) → URL `https://<api>.onrender.com/health`,
  intervalle 5 minutes.
- Un seul service tenu éveillé consomme environ 744 h par mois, sous le quota
  gratuit de 750 h de l'espace Render. Un second service éveillé en
  permanence le dépasserait : ne surveille que l'API (le site statique ne
  dort pas).
- Les 2 workers gunicorn et le limiteur `memory://` restent en l'état.
  Passer au plan payant (D9) permettra d'ajouter Render Key Value (Redis) pour
  `RATELIMIT_STORAGE_URI`.

## 10. Après la phase 1

- Supprime `attendu.sql`, `prod.sql` et la base locale `tcheyna_compare`
  (`dropdb -U postgres tcheyna_compare`).
- Garde le `.dump` hors du dépôt quelques jours, puis supprime-le.
- Pour les prochaines révisions : `flask db upgrade` depuis ton poste avant
  chaque merge qui en contient une (le corps de la PR le signale), ou ajoute-le
  en tête de `startCommand` dans `render.yaml`.

## 11. Purge nocturne des pièces (lot 1.19, D5 et D13)

D5 : une pièce d'identité ou de revenus est supprimée dès la décision, et au
plus tard 12 mois après son dépôt si personne ne l'a examinée. Ce délai est
tenu par le cron job Render `tcheyna-purge-pieces` (D13), décrit dans
`render.yaml` : chaque nuit à 03:00 UTC (03:00 à Conakry), il lance

```bash
cd backend && flask donnees retenter-suppressions; reprise=$?;
flask donnees purger-pieces && exit $reprise
```

- `retenter-suppressions` reprend les fichiers dont la suppression a échoué
  (Supabase injoignable) ; elle sort en erreur s'il en reste.
- `purger-pieces` supprime les pièces sans décision depuis plus de
  `DUREE_CONSERVATION_PIECES_JOURS` jours (365). Elle tourne même si la
  reprise a échoué ; ses propres échecs sont repris la nuit suivante.
- Une exécution « Failed » signale l'un ou l'autre échec : lire ses journaux.

Coût : facturation à la seconde, **1 $ minimum par mois** (plus petite
instance, `0.5c-512mb`). Aucune offre gratuite pour les cron jobs.

**Mise en place, une fois, après le merge :**

1. Render → Blueprints → le Blueprint du dépôt → « Manual Sync » (ou
   automatique si Auto Sync est actif). S'il n'existe pas de Blueprint, les
   services ayant été créés autrement : crée le cron job à la main
   (New → Cron Job) avec les valeurs de `render.yaml`, plutôt que de lier un
   Blueprint qui réappliquerait toute la configuration aux services existants.
2. Render → `tcheyna-purge-pieces` → Environment : vérifie que
   `DATABASE_URL`, `SUPABASE_URL` et `SUPABASE_SERVICE_KEY` sont remplis
   (recopiés de `tcheyna-api`), ainsi que `SECRET_KEY` et `JWT_SECRET_KEY`
   (générés). Sans `DATABASE_URL`, l'exécution échoue au démarrage par un
   `RuntimeError` explicite ; sans Supabase, les fichiers restent en file.
3. « Trigger Run » sur la page Runs du cron, puis ouvre l'exécution : les
   journaux doivent afficher `… suppression(s) reprise(s), 0 encore en échec.`
   puis `… fichier(s) purgé(s).`, et l'exécution finir « Succeeded ».

Les variables recopiées de `tcheyna-api` (`fromService`) ne suivent pas en
direct : après avoir changé `DATABASE_URL` ou la clé Supabase sur l'API,
relance « Manual Sync » (ou corrige aussi la valeur sur le cron).

Contrôle en lecture seule, dans le SQL Editor de Supabase, des fichiers
restés en file :

```sql
SELECT origine, count(*) AS fichiers, max(tentatives) AS tentatives_max,
       min(created_at) AS plus_ancien
FROM fichiers_a_supprimer
GROUP BY origine
ORDER BY plus_ancien;
```

## 12. Render : appliquer `render.yaml` à la main (lot 1.24)

Les services Render de Tcheyna ont été créés sans Blueprint : **`render.yaml`
n'est pas appliqué automatiquement**. Ce qu'une PR y change ne prend effet
qu'une fois reporté à la main dans le tableau de bord. Constaté le 27/10/2026 :
le site statique n'envoie ni la CSP ni les autres en-têtes de sécurité du lot
1.17 (seuls `nosniff` et HSTS, posés d'office par Render, sont présents).

Règle (`.claude/rules/multi-agents.md`) : toute PR qui modifie `render.yaml`
donne dans son corps l'action manuelle équivalente.

### a) En-têtes du site statique

Render → service **`tcheyna`** (Static Site) → **Headers** (menu du service ;
selon la version de l'interface, Settings → Headers). Pour chaque règle
ci-dessous : « Add Header », puis Path, Name et Value **copiés tels quels**,
puis « Save Changes ». Les valeurs viennent de `render.yaml` (service
`tcheyna`, clé `headers`) ; elles ne contiennent aucun secret.

Avant d'ajouter, supprime une éventuelle règle existante de même Path et de
même Name, pour ne pas envoyer l'en-tête deux fois. `/*` couvre toutes les
adresses du site, y compris celles réécrites vers `index.html`.

**Règle 1 : cache long des fichiers du build**
- Path : `/assets/*`
- Name : `Cache-Control`
- Value :
  ```
  public, max-age=31536000, immutable
  ```

**Règle 2 : service worker toujours revérifié**
- Path : `/sw.js`
- Name : `Cache-Control`
- Value :
  ```
  no-cache
  ```

**Règle 3 : manifest toujours revérifié**
- Path : `/manifest.webmanifest`
- Name : `Cache-Control`
- Value :
  ```
  no-cache
  ```

**Règle 4 : politique de sécurité du contenu (CSP)**, valeur sur une seule ligne :
- Path : `/*`
- Name : `Content-Security-Policy`
- Value :
  ```
  default-src 'self'; script-src 'self' 'unsafe-hashes' 'sha256-9gOBGqEQINNDuds+tkXbNzih6klbz+KeCyxEj4KRLeM='; style-src 'self' https://fonts.googleapis.com 'sha256-4fLmxw9BupI3iooEXtTtNH0Cs3dvHVHAPY1IjcoaLJc='; font-src 'self' https://fonts.gstatic.com; img-src 'self' blob: https://*.supabase.co https://tcheyna-api.onrender.com; connect-src 'self' https://tcheyna-api.onrender.com https://*.supabase.co; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'
  ```

**Règle 5**
- Path : `/*`
- Name : `X-Content-Type-Options`
- Value :
  ```
  nosniff
  ```
  Render pose déjà cet en-tête. Si la vérification (b) le montre en double
  (`nosniff, nosniff`), supprime cette règle.

**Règle 6**
- Path : `/*`
- Name : `Referrer-Policy`
- Value :
  ```
  strict-origin-when-cross-origin
  ```

**Règle 7**
- Path : `/*`
- Name : `Permissions-Policy`
- Value :
  ```
  camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), midi=(), display-capture=(), browsing-topics=()
  ```

Vérifie aussi, dans **Redirects/Rewrites** du même service, la règle de
l'application monopage : Source `/*`, Destination `/index.html`, Action
**Rewrite**. Sans elle, recharger `/tenant/dashboard` renvoie une 404.

Si la valeur de la CSP change dans `render.yaml` (par exemple quand
`node scripts/verifier-csp.mjs` signale une nouvelle empreinte de
`public/hors-ligne.html`), recopie la nouvelle valeur dans la règle 4.

### b) Vérifier

Depuis PowerShell, sur le site en production :

```powershell
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$site = "https://tcheyna.onrender.com"
$noms = "content-security-policy|x-content-type-options|referrer-policy|permissions-policy|strict-transport-security|cache-control"
function Entetes($url) {
  $r = Invoke-WebRequest -Uri $url -UseBasicParsing
  "--- $url"
  $r.Headers.GetEnumerator() | Where-Object { $_.Key -match $noms } |
    Sort-Object Key | Format-Table Key, Value -AutoSize -Wrap | Out-String -Width 400
}
Entetes "$site/"
Entetes "$site/tenant/dashboard"   # page réécrite vers index.html
Entetes "$site/sw.js"
# Un fichier du build : son nom change à chaque déploiement, on le lit dans index.html.
$page = (Invoke-WebRequest -Uri "$site/" -UseBasicParsing).Content
$asset = [regex]::Match($page, '/assets/[^"'']+\.js').Value
Entetes "$site$asset"
```

Attendu :
- sur `/`, `/tenant/dashboard` et `sw.js` : `Content-Security-Policy` (la
  valeur de la règle 4), `X-Content-Type-Options: nosniff` (une seule fois),
  `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, et
  `Strict-Transport-Security` (posé par Render) ;
- `sw.js` : `Cache-Control: no-cache` ;
- le fichier `/assets/…js` : `Cache-Control: public, max-age=31536000, immutable`.

Ouvre ensuite le site dans un navigateur, F12 → Console, et parcours
l'accueil, une annonce, la connexion et la messagerie. **Aucun message
« Content Security Policy » ne doit apparaître.** S'il en apparaît un (page
blanche, police ou photo absente), supprime la règle 4 pour rétablir le site,
puis signale le message exact : la CSP sera corrigée dans `render.yaml`.

### c) Variables d'environnement

Une variable `sync: false` de `render.yaml` n'a jamais de valeur dans le
dépôt : elle se saisit dans Render → le service → Environment. Celles qui
restent à poser à la main sont listées dans le corps de la PR qui les ajoute
(par exemple `TACHES_NOCTURNES_JETON`, lot 1.25, ou `AT_USERNAME`, lot 1.17).
Une variable avec `value:` dans `render.yaml` doit avoir la même valeur dans le
tableau de bord : en cas d'écart, c'est le tableau de bord qui fait foi pour
le service en production.
