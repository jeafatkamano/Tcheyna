# Documentation

## Guide d'installation et de déploiement

`generer_guide.py` produit `Tcheyna-Guide-Installation-Deploiement.pdf`, placé
à la racine du dépôt. Ce guide s'adresse à quelqu'un qui découvre le projet et
doit le lancer en local ou le mettre en production.

### Régénérer le PDF

```bash
pip install -r docs/requirements.txt
python docs/generer_guide.py
```

Le script écrit à la racine du dépôt quel que soit le répertoire depuis lequel
il est appelé. Passez un chemin en argument pour changer la destination.

### Modifier le contenu

Le texte se trouve en fin de `generer_guide.py`, dans la section « Contenu ».
Les briques de mise en page (`titre_section`, `bloc_code`, `encart`, `tableau`,
`puces`) sont définies au-dessus et documentées sur place.

Le guide reprend les mêmes procédures que le `README.md` de la racine, sous une
forme imprimable et partageable. **Faire évoluer les deux ensemble** : une étape
d'installation qui change doit être corrigée aux deux endroits.

### Polices et caractères

Le document s'appuie sur Helvetica et Courier, les polices standard du format
PDF, pour rester lisible partout sans embarquer de fichier de police. Elles se
limitent au jeu Latin-1 : les accents français passent, mais pas les caractères
de dessin d'arbre (`├── │ └──`) ni les flèches.

`bloc_code` avertit à la génération dès qu'un caractère sort de ce jeu, plutôt
que de laisser un carré noir passer inaperçu dans le PDF. Si un avertissement
apparaît, remplacez le caractère fautif par son équivalent ASCII.
