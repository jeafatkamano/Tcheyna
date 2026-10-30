# Maquette de l'app mobile Tcheyna (validée par Kamano le 30/10/2026)

Source : canevas Claude Design « Tcheyna — Présentation au premier lancement ».
Chaque fichier `.dc.html` est un écran de 390 × 844 px (zone de la barre
d'état comprise : les 56 px du haut). Ils servent de **référence visuelle** :
couleurs, tailles, rayons, espacements et textes exacts sont dans les
attributs `style`. Ils ne s'ouvrent pas seuls dans un navigateur (ils
dépendent de l'éditeur `support.js`) : on les lit, on ne les copie pas.

| Fichier | Écran |
| --- | --- |
| Main.dc.html | Présentation 1 · Annonces certifiées |
| Ecran2.dc.html | Présentation 2 · Passeport Locataire |
| Ecran3.dc.html | Présentation 3 · Messagerie et visites + choix du rôle |
| Connexion.dc.html | Connexion |
| Inscription1.dc.html | Inscription, étape 1 (rôle, nom, téléphone, e-mail) |
| Inscription2.dc.html | Inscription, étape 2 (mot de passe, ville, quartier, CGU) |
| CodeSMS.dc.html | Vérification du numéro (code à 6 chiffres) |
| MotDePasse.dc.html | Mot de passe oublié |
| Accueil.dc.html | Accueil locataire |
| Annonces.dc.html | Liste des annonces |
| Annonce.dc.html | Détail d'une annonce |
| Messages.dc.html | Liste des discussions |
| Discussion.dc.html | Discussion |
| Profil.dc.html | Profil · Passeport Locataire |

Les noms, prix, quartiers et heures sont des exemples : l'app affiche les
vraies données de l'API.
