# Où recharger — recherche de bornes de recharge

Application web de recherche de bornes de recharge pour véhicule électrique en
France : **38 980 stations**, **154 426 points de charge**, filtrables par
réseau/marque, puissance, type de prise, services et disponibilité.

Aucune dépendance, aucun build : `index.html` s'ouvre tel quel. La carte est
dessinée en canvas (projection Web Mercator maison), il n'y a ni bibliothèque
cartographique ni tuiles distantes — l'app reste donc utilisable hors ligne et
dans un contexte où les requêtes sortantes sont bloquées.

```bash
python3 -m http.server 8000   # puis http://localhost:8000/
```

## Ce qu'on peut filtrer

| Filtre | Détail |
|---|---|
| Lieu + rayon | géolocalisation, ville, adresse ou code postal, rayon 1–100 km |
| Puissance minimale | ≥ 7,4 / 22 / 50 / 150 / 300 kW |
| Réseau / enseigne | 1 817 réseaux normalisés, sélection multiple |
| Type de prise | Type 2, CCS, CHAdeMO, prise E/F |
| Disponibilité | toutes / ouvertes maintenant / libres maintenant |
| Services | gratuit, CB, paiement à l'acte, accès libre, PMR, réservation, deux-roues |

Tri par distance, puissance, nombre de points de charge ou nom.

## Les deux sens de « disponibilité »

La distinction est faite explicitement dans l'interface, parce que les deux
niveaux n'ont pas la même valeur :

1. **Ouvertes maintenant** — déduit du champ `horaires` du jeu IRVE (syntaxe
   *opening_hours* d'OpenStreetMap, analysée par `js/horaires.js`). Couvre toute
   la France, mais ne dit rien de l'occupation réelle des bornes.
2. **Libres maintenant** — statut temps réel des points de charge. Un seul
   opérateur publie aujourd'hui un flux ouvert exploitable sans clé :
   **Belib' (Ville de Paris)**, soit environ 1 950 points suivis sur 380
   stations. Ailleurs, les statuts circulent en OCPI privé — la recherche sur
   data.gouv.fr et sur la fédération Opendatasoft n'a rien trouvé d'autre.
   `js/dispo.js` tient un registre de fournisseurs pour en brancher d'autres : il
   suffit d'ajouter une entrée `{ id, nom, zone, url, lire }`. Les points sont
   rattachés aux stations par proximité (150 m), les flux n'exposant pas
   d'identifiant de station fiable. Chaque point rejoint la station **la plus
   proche** dans un rayon de 80 m : plus large, l'appariement accrochait en
   centre-ville les bornes du trottoir d'en face.

Hors zone couverte, le filtre « libres maintenant » est désactivé et l'interface
le dit, plutôt que de laisser croire à une couverture nationale.

## Données

Source : [fichier consolidé des bornes de recharge (IRVE)](https://www.data.gouv.fr/datasets/fichier-consolide-des-bornes-de-recharge-pour-vehicules-electriques/),
data.gouv.fr / Etalab — Licence Ouverte. Le CSV source (150 Mo, une ligne par
point de charge) est agrégé **par station** en un instantané compact
(`donnees/stations.js`, 4,4 Mo) : colonnes parallèles chargées côté client en
TypedArrays, ce qui permet de rebalayer les 38 980 stations à chaque frappe.

Régénérer après une mise à jour du fichier source :

```bash
curl -L -o irve.csv https://www.data.gouv.fr/fr/datasets/r/eb76d20a-8501-400e-b336-d85724de5435
python3 tools/construire_snapshot.py irve.csv /tmp/stations.json
python3 tools/construire_artifact.py ou-recharger.html   # version un seul fichier
```

### Ce que le pipeline corrige

Le fichier consolidé agrège les déclarations de centaines d'aménageurs, avec les
écarts que cela suppose. `tools/` traite ce qui fausserait une recherche :

- **Réseaux normalisés** (`normalisation.py`) : « LIDL » / « Lidl France »,
  « Tesla » / « TESLA France SARL », « Freshmile | FR\*FR1 » deviennent une seule
  marque. Sans ça le filtre par enseigne est inutilisable.
- **Identifiants techniques** retirés des noms (« Charge Unix/50444d1a-ac94-… »).
- **Points de charge dédupliqués** et regroupés par station.
- **Doublons inter-sources fusionnés** (18 144 stations absorbées). Le fichier
  consolidé agrège plusieurs producteurs — l'opérateur lui-même, eco-movement,
  qualicharge — si bien qu'une même station physique y figure sous plusieurs
  identifiants : l'Electra de l'Intermarché La Cepière à Toulouse apparaît sous
  `FRELCPTOUCAC` **et** `FRELCP12954111`, aux mêmes coordonnées. Deux stations
  du même réseau distantes de moins de 25 m sont fusionnées, en retenant le
  **maximum** de points de charge et non la somme : ce sont les mêmes bornes
  décrites deux fois.

  Ordre de grandeur : la source décrit 224 488 lignes pour 167 315 identifiants
  de points de charge distincts — et ces identifiants comptent encore deux fois
  les bornes publiées par deux producteurs. Après fusion, l'app en dénombre
  **154 426**. Sans cette passe, le total affiché serait de 278 618.

- **Points de charge comptés, pas déclarés** : le champ `nbre_pdc` est
  déclaratif et parfois faux — une station Bump du 4ᵉ arrondissement annonce
  229 points pour 21 réellement identifiés. On compte donc les identifiants de
  points de charge distincts, et on ne retombe sur la valeur déclarée qu'à
  défaut d'identifiant. Quand un flux temps réel suit la station, c'est **son**
  décompte qui fait référence : il est mesuré.
- **Caractères irrécupérables** : quelques lignes arrivent avec un encodage déjà
  perdu à la source (« ESPLANADE DES F�TES ») ; le caractère est remplacé par
  `?` plutôt que deviné.

### Ce que le pipeline ne corrige pas

- **Puissances invraisemblables** : 110 stations déclarent plus de 400 kW sur un
  point de charge, ce qui est presque toujours la puissance cumulée de la
  station. La valeur officielle est conservée mais **signalée** dans l'interface
  (`900 kW ?`) — l'app ne réécrit pas la donnée publique.
- **Grandes stations** : 456 stations dépassent 20 points de charge et 22 en
  dépassent 100. Certaines sont de vrais grands parkings, d'autres des
  regroupements abusifs par l'opérateur ; faute de critère fiable pour trancher,
  la valeur observée est conservée telle quelle.
- **Sites à plusieurs stations** : si un même réseau exploite réellement deux
  stations distinctes à moins de 25 m l'une de l'autre, la fusion les compte
  pour une seule. Le cas est rare et le biais reste très inférieur à celui du
  double comptage.
- **Couverture cartographique** : le fond de carte trace les départements
  métropolitains. Les stations des DROM sont bien présentes et cherchables, mais
  sans contour sous elles.
- Les données sont **déclaratives** : une borne présente dans le fichier peut
  être en panne, et une borne récente peut manquer.

## Organisation

| Fichier | Rôle |
|---|---|
| `index.html`, `style.css` | structure et feuille de style (thème clair/sombre) |
| `js/donnees.js` | modèle en TypedArrays, distances, paliers de puissance |
| `js/horaires.js` | analyse du champ `horaires` (opening_hours) |
| `js/dispo.js` | registre des flux temps réel, appariement aux stations |
| `js/carte.js` | carte canvas : projection, déplacement, zoom, clusters |
| `js/app.js` | filtres, liste, fiche station, recherche de lieu |
| `donnees/` | instantané des stations et contour des départements (générés) |
| `tools/` | scripts de génération |

La recherche de lieu interroge la [Base Adresse Nationale](https://adresse.data.gouv.fr/)
quand le réseau est disponible, et retombe sinon sur les communes de
l'instantané — l'app reste donc utilisable sans aucun accès sortant.

## Publier sur GitHub Pages

L'application est un site statique : n'importe quel hébergeur de fichiers fait
l'affaire. Servie depuis une vraie adresse plutôt que dans un cadre restreint,
elle retrouve la géolocalisation, l'ouverture des applications de navigation et
le flux temps réel.

```bash
./webapp-bornes/deployer-pages.sh          # dépôt « ou-recharger » par défaut
./webapp-bornes/deployer-pages.sh mon-nom  # ou le nom de votre choix
```

Le script crée un dépôt **public et dédié**, y pousse l'app et active Pages.
L'adresse est alors `https://<compte>.github.io/<dépôt>/`.

Le dépôt est délibérément séparé : celui-ci est privé et contient des données
clients, l'ouvrir pour servir une page serait une fuite. Le dépôt publié ne
contient que l'application et des données publiques (IRVE, Licence Ouverte).

### Sans le client `gh`

1. Créer un dépôt public vide sur GitHub, par exemple `ou-recharger`.
2. Depuis la racine de ce dépôt-ci :

   ```bash
   cd webapp-bornes
   git init -b main && git add -A && git commit -m "Où recharger"
   git remote add origin https://github.com/<compte>/ou-recharger.git
   git push -u origin main
   ```

3. Dans le dépôt sur GitHub : **Settings → Pages**, source « Deploy from a
   branch », branche `main`, dossier `/ (root)`, puis **Save**.

Comptez une à deux minutes avant la mise en ligne.

