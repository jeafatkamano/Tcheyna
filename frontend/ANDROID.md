# Application Android (APK)

L'application Android est le frontend React emballé avec
[Capacitor](https://capacitorjs.com). L'interface est **dans l'APK** : l'appli
s'ouvre sans réseau et pendant le réveil de l'API Render gratuite (~50 s).
Seules les données passent par `https://tcheyna-api.onrender.com/api`.

> Chaque changement d'interface demande une **nouvelle APK** : le site web se
> met à jour seul, l'appli installée non.

## Obtenir l'APK

L'APK est construite par GitHub Actions (workflow `APK Android`), pas sur le PC.

- **APK d'une PR ou construite à la demande** : onglet *Actions* →
  *APK Android* → le run → section *Artifacts* → `apk-tcheyna` (fichier zip,
  gardé 14 jours). Construire à la demande : *Run workflow*.
- **Version publiée** : onglet *Releases* du dépôt. Le dépôt est public : le
  lien de la Release peut être envoyé directement aux testeurs.

Le nom du fichier dit comment il est signé :

| Fichier | Signature | Mise à jour par la version suivante |
|---|---|---|
| `tcheyna-1.1.0-42.apk` | vraie clé Tcheyna | oui |
| `tcheyna-TEST-non-signee-1.1.0-42.apk` | clé de test (debug) | **non** : désinstaller d'abord |

## Publier une version

1. Mettre à jour `"version"` dans `frontend/package.json` (ex. `1.2.0`) par
   une PR, et la merger.
2. Depuis `main` à jour, en cmd :

   ```
   git checkout main
   git pull
   git tag apk-v1.2.0
   git push origin apk-v1.2.0
   ```

Le workflow construit l'APK et crée la Release `apk-v1.2.0` avec l'APK jointe.
Le `versionCode` Android est le numéro du run GitHub : il croît toujours, ce
qu'Android exige pour accepter une mise à jour.

## Installer sur un téléphone

1. Télécharger l'APK sur le téléphone (lien de la Release, ou fichier reçu par
   WhatsApp).
2. L'ouvrir : Android demande d'autoriser l'installation depuis cette source
   (« sources inconnues ») pour le navigateur ou WhatsApp. Accepter.
3. Une APK de test ne remplace pas une APK signée avec la vraie clé (et
   inversement) : désinstaller l'ancienne d'abord.

Android 7 (API 24) minimum.

## Clé de signature

Sans clé, toutes les APK sont des APK de test. Avec la vraie clé, chaque APK
met à jour la précédente sans perdre la session de l'utilisateur.

1. Créer la clé, **hors du dépôt**, en cmd (`keytool` est livré avec le JDK,
   dans son dossier `bin`) :

   ```
   keytool -genkeypair -v -keystore "%USERPROFILE%\Documents\tcheyna-release.jks" -alias tcheyna -keyalg RSA -keysize 2048 -validity 10000
   ```

2. Faire **deux copies** du fichier `.jks` et de ses mots de passe hors du PC
   (clé USB + coffre de mots de passe). Clé perdue = plus aucune mise à jour
   possible de l'appli, sur le Play Store comme en téléchargement direct.
3. L'encoder en base64 (une seule ligne) :

   ```
   certutil -encodehex -f "%USERPROFILE%\Documents\tcheyna-release.jks" "%USERPROFILE%\Documents\tcheyna-release.b64" 0x40000001
   ```

4. Créer les 4 secrets du dépôt (GitHub → *Settings* → *Secrets and
   variables* → *Actions*), ou en cmd :

   ```
   gh secret set ANDROID_KEYSTORE_BASE64 -R jeafatkamano/Tcheyna < "%USERPROFILE%\Documents\tcheyna-release.b64"
   gh secret set ANDROID_KEYSTORE_PASSWORD -R jeafatkamano/Tcheyna
   gh secret set ANDROID_KEY_ALIAS -R jeafatkamano/Tcheyna
   gh secret set ANDROID_KEY_PASSWORD -R jeafatkamano/Tcheyna
   ```

   (les trois dernières commandes demandent la valeur au clavier ; l'alias est
   `tcheyna`).
5. Supprimer le fichier `.b64` : `del "%USERPROFILE%\Documents\tcheyna-release.b64"`.

## Ce que l'appli change côté API

- **CORS** : l'origine de la WebView Android est `https://localhost`. Elle doit
  figurer dans `CORS_ORIGINS` du service Render `tcheyna-api`
  (`https://tcheyna.onrender.com,https://localhost`). Ce n'est pas une faille :
  la session est un jeton envoyé dans l'en-tête `Authorization` (stocké dans
  `localStorage`), jamais un cookie ; une autre page servie sur
  `https://localhost` n'a pas ce jeton et ne peut pas agir à la place d'un
  utilisateur.
- **Images** : les chemins `/uploads/...` passent par `urlFichier`
  (`src/api/client.ts`), qui les préfixe avec l'URL de l'API.
- **Déconnexion** : `window.location.href = "/login"` recharge l'interface
  embarquée sur la page de connexion (Capacitor sert `index.html` pour toute
  route).
- **Paiement CinetPay** : la page de paiement s'ouvre hors de l'appli, et le
  `return_url` ramène sur le **site**, pas dans l'appli. Le paiement reste
  juste (c'est le webhook qui le valide) : l'utilisateur revient dans l'appli
  à la main et y voit son paiement. Correction prévue, non faite : voir la PR.
- **Sauvegarde Android désactivée** (`allowBackup="false"`) : les jetons de
  session ne partent pas dans les sauvegardes du téléphone.

## Développement local

Le PC n'a pas besoin du SDK Android. Après une modification du projet natif
(`android/`) ou d'un plugin Capacitor :

```
cd frontend
npm run android:sync
```

`android/` est versionné (usage Capacitor) ; `android/app/src/main/assets/public`
est une copie de `dist/` régénérée à chaque `cap sync`, non versionnée.
