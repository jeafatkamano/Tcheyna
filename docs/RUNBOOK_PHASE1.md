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
| Inscription → OTP | Code reçu par SMS. Sans fournisseur SMS configuré (`NIMBA_*`, `ORANGE_SMS_*`), l'API répond 503 « envoi de SMS indisponible » |
| Recherche d'annonces | Résultats, photos affichées |
| Admin → état de la configuration (`GET /api/admin/diagnostic`) | Stockage « prêt », pas d'alerte sur les clés |
| Initier un paiement `caution` ou `premier_loyer` | Refusé (D2 = A) |
| Téléverser une photo d'annonce | Acceptée, ré-encodée en WebP |

## 6 bis. Récupérer un compte administrateur (lot 1.22)

Un administrateur n'a aucune récupération en libre-service : ni connexion par
téléphone, ni « Mot de passe oublié » par SMS (décision du 27/10/2026). Si
un administrateur a perdu son mot de passe, ou s'il faut le changer d'urgence
(fuite), on le réinitialise depuis un poste qui a la base de production.

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
$env:PGPROD = Read-Host "Chaîne Session pooler de PRODUCTION"
$env:FLASK_APP = "run.py"; $env:FLASK_ENV = "production"
$env:DATABASE_URL = $env:PGPROD
# ProductionConfig exige aussi des secrets forts ; pour cette commande, des
# valeurs jetables suffisent (elle ne signe rien).
$env:SECRET_KEY = python -c "import secrets; print(secrets.token_urlsafe(48))"
$env:JWT_SECRET_KEY = python -c "import secrets; print(secrets.token_urlsafe(48))"

flask admin reinitialiser-mot-de-passe admin@exemple.com
# Le nouveau mot de passe est demandé deux fois, sans s'afficher
# (8 caractères minimum). Attendu :
# « Mot de passe de admin@exemple.com réinitialisé ; toutes ses sessions sont fermées. »

Remove-Item Env:DATABASE_URL, Env:PGPROD, Env:SECRET_KEY, Env:JWT_SECRET_KEY
cd ..
```

`$env:PGPROD` est la même chaîne qu'à la section 2 (voir la section 0,
point 4). Elle est demandée par `Read-Host`, qui ne l'inscrit pas dans
l'historique du terminal : ne la colle pas directement dans une commande.
Vérifie qu'elle désigne bien la **production** : la commande agit sur la base
de `DATABASE_URL`, quelle qu'elle soit.

- Le mot de passe ne se passe **jamais** en argument : la commande le refuse,
  et il resterait dans l'historique du terminal.
- Toutes les sessions du compte sont fermées, sur tous les appareils, et
  tout code OTP encore valide est annulé.
- La commande refuse un compte qui n'est pas administrateur (il passe par
  « Mot de passe oublié ») et un e-mail inconnu. Pour créer un administrateur
  ou en promouvoir un : `python create_admin.py`.
- Si le compte est désactivé, la commande le signale : un autre administrateur
  doit le réactiver (Admin → Utilisateurs).
- La commande tourne sur ton poste : sa trace est le message affiché dans ton
  terminal, pas les journaux Render.

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

## 11. Tâches nocturnes (lot 1.25, D5, D13 révisée)

D5 : une pièce d'identité ou de revenus est supprimée dès la décision, et au
plus tard 12 mois après son dépôt si personne ne l'a examinée. D'autres
tâches tournent aussi chaque nuit : validité de 3 mois des justificatifs de
revenus (D12), expiration des annonces sans activité (D6), rappels de visite.

D13 révisée (27/10/2026) : **pas de Render Cron Job** (Render exige une carte
bancaire, même pour 1 $ par mois). Chaque nuit, **cron-job.org** (gratuit)
appelle une route de l'API protégée par un jeton :

```
POST https://tcheyna-api.onrender.com/api/interne/taches-nocturnes
X-Taches-Jeton: <le jeton>
```

La route enchaîne, dans cet ordre, les mêmes fonctions que les commandes
`flask` : reprise des suppressions de fichiers en échec, purge des pièces,
expiration des revenus, expiration des annonces, rappels de visite. Chaque
étape tourne même si une précédente échoue. Les clés de la base restent sur
Render : seul le jeton sort, et il ne permet que de lancer ces tâches, toutes
rejouables sans doublon.

- Jeton absent sur Render : la route répond 404 (fonction désactivée).
- Jeton faux ou absent dans l'appel : 401. Le jeton n'est lu que dans
  l'en-tête, jamais dans l'URL.
- Limites : 5 échecs (mauvais jeton) par heure et par IP ; 10 appels par jour
  avec le bon jeton, toutes IP confondues. Les échecs ne comptent pas contre
  le bon jeton : un inconnu ne peut pas épuiser la limite avant cron-job.org.
- Le jeton doit être différent de `SECRET_KEY`, `JWT_SECRET_KEY` et
  `OTP_HMAC_KEY` : sinon l'API refuse de démarrer.
- Réponse : 200 si tout a réussi, 500 si une étape a échoué (cron-job.org
  compte alors l'exécution en échec et prévient par e-mail). Le corps donne,
  pour chaque étape, ses compteurs et son erreur éventuelle ; le détail
  d'une erreur est dans les journaux Render, pas dans la réponse.
- Durée : cron-job.org coupe l'appel au bout de 30 s. Chaque étape a un
  budget de 5 s ; passé ce délai, elle s'arrête et le reste attend la nuit
  suivante (`"complete": false` dans la réponse). Une étape incomplète n'est
  pas un échec. Si elle l'est plusieurs nuits de suite, relance l'appel à
  la main (voir « Vérifier ») ou lance la commande `flask` correspondante
  depuis ton poste.
- L'API doit être réveillée : le ping UptimeRobot de la section 9 s'en
  charge. Un appel sur une API endormie peut dépasser 30 s.

### Mise en place, une fois

**1. Générer le jeton**, sur ton poste :

```powershell
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Garde-le dans ton gestionnaire de mots de passe : il ne doit apparaître ni
dans le dépôt, ni dans une URL, ni dans un message.

**2. Le saisir sur Render** : Dashboard → `tcheyna-api` → Environment →
« Add Environment Variable » → clé `TACHES_NOCTURNES_JETON`, valeur = le
jeton → « Save Changes ». Render redéploie l'API. Moins de 32 caractères :
l'API refuse de démarrer, avec un message qui le dit.

**3. Créer la tâche sur cron-job.org** (compte gratuit, libellés de
l'interface en anglais) : « Create cronjob », puis

| Réglage | Valeur |
|---|---|
| Title | `Tcheyna — tâches nocturnes` |
| URL | `https://tcheyna-api.onrender.com/api/interne/taches-nocturnes` |
| Execution schedule | tous les jours (« Every day ») à `03:00` |
| Time zone (onglet Advanced) | `Africa/Conakry` |
| Request method (onglet Advanced) | `POST` |
| Headers (onglet Advanced) | clé `X-Taches-Jeton`, valeur = le jeton |
| Request body | vide |
| Save responses in job history | activé |
| Notifications | e-mail quand l'exécution échoue, quand elle refonctionne, et quand la tâche est désactivée |

Enregistre, puis lance une première exécution (« Test run » ou « Run now »).
cron-job.org coupe tout appel au bout de 30 s (limite fixe).

**4. Réveiller l'API avant l'appel** (recommandé) : une seconde tâche
cron-job.org, `GET https://tcheyna-api.onrender.com/health`, tous les jours
à `02:55` (Africa/Conakry), sans en-tête. Elle ne dépend plus du ping
UptimeRobot de la section 9, qui n'est que provisoire.

**5. Si un Render Cron Job `tcheyna-purge-pieces` a été créé** à la main
d'après l'ancienne version de ce fichier : le supprimer (Render → le service
→ Settings → Delete), sinon les tâches passeraient deux fois et il serait
facturé.

### Tâche désactivée par cron-job.org

cron-job.org désactive une tâche après une suite d'échecs, et prévient par
e-mail. Cause la plus probable : un fichier que Supabase refuse durablement
fait échouer l'étape de reprise chaque nuit (`"en_echec"` > 0), même si la
purge et les autres étapes tournent. Pour en sortir :

1. Render → `tcheyna-api` → Logs : `Suppression différée (…) : <référence>`
   donne le fichier, et la requête de contrôle ci-dessous ses tentatives.
2. Supprime le fichier à la main dans Supabase → Storage (ou vérifie qu'il
   n'existe plus) : à la reprise suivante, un fichier absent compte comme
   supprimé et sa ligne disparaît.
3. Réactive la tâche sur cron-job.org et lance-la une fois (« Run now ») :
   attendu `200`.

### Vérifier

- **cron-job.org** → la tâche → History : chaque exécution affiche le code
  HTTP, la durée et le corps de la réponse (conservé 2 jours). Attendu :
  `200`, `"ok": true` et `"complete": true` pour chaque étape.
- **Render** → `tcheyna-api` → Logs : une étape en échec y écrit
  `Tâche nocturne « <étape> » en échec` avec la trace complète.
- Avant la mise en service, confirme `TRUSTED_PROXY_HOPS` (section 1) :
  s'il est faux, les limites par IP de toute l'API (connexion comprise)
  visent l'IP d'un proxy partagé au lieu de celle du client.
- **À la main**, depuis PowerShell (10 appels par jour au plus avec le bon jeton) :

```powershell
$jeton = Read-Host "Jeton des tâches nocturnes"
Invoke-RestMethod -Method Post `
  -Uri "https://tcheyna-api.onrender.com/api/interne/taches-nocturnes" `
  -Headers @{ "X-Taches-Jeton" = $jeton } | ConvertTo-Json -Depth 5
```

Un 500 lève une erreur dans PowerShell ; le détail est alors dans les
journaux Render.

Les commandes restent disponibles pour un lancement manuel depuis un poste
qui a `DATABASE_URL` (mêmes précautions qu'à la section 4) :
`flask donnees retenter-suppressions`, `flask donnees purger-pieces`,
`flask donnees expirer-revenus`, `flask annonces expirer`,
`flask visites rappeler`.

**Changer le jeton** (fuite, départ d'un tiers) : générer un nouveau jeton,
le saisir sur Render, attendre le redéploiement, puis le reporter dans
l'en-tête de la tâche cron-job.org. **Désactiver** : supprimer la variable
sur Render (la route répond 404), puis désactiver la tâche sur cron-job.org.

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
ci-dessous : ajoute une règle (bouton d'ajout de la page Headers), remplis
Path, Name et Value **copiés tels quels**, puis enregistre. Les libellés
exacts des boutons dépendent de la version de l'interface. Les valeurs viennent de `render.yaml` (service
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

## 13. SMS des codes OTP (lot 1.27)

Sans SMS, personne ne vérifie son numéro : tout le monde reste au niveau 0 et
ne peut pas candidater. Africa's Talking, prévu à l'origine, **ne couvre pas
la Guinée** (liste de pays sur help.africastalking.com). Le serveur essaie,
dans l'ordre, chaque fournisseur dont les variables sont renseignées :

1. **Nimba SMS** (principal) : agrégateur guinéen, tous opérateurs.
2. **Orange SMS API Guinée** (secours) : opérateur officiel, paiement Orange Money.
3. Africa's Talking : hors Guinée seulement (Côte d'Ivoire, Ghana, Nigeria…).

En production, si aucun SMS ne part, `/api/auth/send-otp` répond **503**
« L'envoi de SMS est momentanément indisponible » au lieu d'annoncer un code
envoyé. Les journaux Render disent quel fournisseur a servi
(`SMS envoyé via nimba à +224…52`) ou pourquoi il a échoué
(`Échec envoi OTP via nimba à … : HTTP 402 …`), sans numéro ni code en clair.

### a) Nimba SMS (à faire en premier)

1. Créer un compte sur nimbasms.com, puis acheter un pack de SMS.
2. Demander le nom d'expéditeur **TCHEYNA** (11 caractères au plus) et attendre
   sa validation : un nom non validé fait refuser les envois.
3. Page « Clés API » du compte : copier le **SERVICE ID** et le **SECRET TOKEN**.
4. Render → `tcheyna-api` → Environment → ajouter :
   - `NIMBA_SERVICE_ID` = le SERVICE ID ;
   - `NIMBA_SECRET_TOKEN` = le SECRET TOKEN ;
   - `NIMBA_SENDER_NAME` = `TCHEYNA` (exactement le nom validé).

   Puis « Save, rebuild and deploy ».

### b) Orange SMS API Guinée (secours, facultatif)

1. developer.orange.com → créer une application → ajouter l'API
   « SMS Guinea Conakry ».
2. Acheter un pack (le premier, 15 SMS pour 1 200 GNF, suffit à tester) avec
   une puce Orange, par crédit ou Orange Money.
3. Demander le nom d'expéditeur **TCHEYNA** par le formulaire (jusqu'à 5 jours
   ouvrés) ; ne pas l'utiliser avant le courriel de confirmation.
4. Page de l'application : copier l'**en-tête d'autorisation** (« Basic … »).
5. Render → `tcheyna-api` → Environment → ajouter :
   - `ORANGE_SMS_AUTH_HEADER` = l'en-tête complet, `Basic` compris ;
   - `ORANGE_SMS_SENDER_NAME` = `TCHEYNA` une fois validé (vide avant).

### c) Vérifier

1. Connecté en administrateur sur le site : `GET /api/admin/diagnostic` →
   `sms.fournisseurs` liste `nimba` (et `orange`).
2. Dans l'app, Profil → Vérification du téléphone → « Recevoir le code par
   SMS » : le SMS arrive en moins d'une minute, sur un numéro Orange **et** sur
   un numéro MTN.
3. Journaux Render : `SMS envoyé via nimba à +224…`.
