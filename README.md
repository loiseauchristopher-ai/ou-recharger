# Où recharger — recherche de bornes de recharge

Application web de recherche de bornes de recharge pour véhicule électrique en
France : **38 980 stations**, **154 426 points de charge** — et le reste du monde
à la demande via OpenStreetMap. Filtrables par
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

L'application distingue trois niveaux, et ne fait jamais passer l'un pour l'autre.

1. **Ouvertes maintenant** — déduit du champ `horaires` du jeu IRVE. Couvre
   toutes les stations, mais ne dit rien de l'occupation réelle des bornes.

2. **Libres maintenant** — état et occupation réellement remontés par les
   opérateurs, via la **base nationale consolidée dynamique** publiée par le
   Point d'Accès National (`transport.data.gouv.fr`). Le règlement européen
   AFIR impose désormais cette publication : ~115 000 points de charge y
   figurent, Belib' compris. Après appariement, **24 044 stations sur 38 980
   (62 %)** ont un état connu.

   Le rattachement se fait par **identifiant d'itinérance**, pas par proximité
   géographique : 97 % des points du flux trouvent leur station, et une borne
   n'est jamais attribuée au trottoir d'en face. La table
   `donnees/index-itinerance.js` (173 641 identifiants, ~580 Ko compressés)
   n'est chargée que si l'utilisateur demande cet état — inutile de la faire
   peser sur le premier affichage.

3. **Relevé ancien** — la fraîcheur varie fortement d'un opérateur à l'autre :
   la moitié des points datent de moins de six heures, un quart de moins d'une
   heure, mais un tiers de plus de vingt-quatre heures. Au-delà de **deux
   heures**, l'état est affiché avec son âge (« 4 libres sur 4 — il y a 25 h »),
   sans la pastille ni le code couleur du direct, et le filtre « Libres
   maintenant » l'exclut.

## Fonds de carte

Quatre fonds, choisis en haut à gauche de la carte et mémorisés d'une visite à
l'autre :

| Fond | Source | Utile pour |
|---|---|---|
| **Plan** | CARTO Voyager (OpenStreetMap) | se repérer dans les rues, trouver l'entrée d'un parking |
| **Satellite** | Esri World Imagery | reconnaître les lieux, repérer un centre commercial |
| **Relief** | OpenTopoMap | anticiper une côte, qui pèse sur la consommation |
| **Sobre** | tracé local des départements | hors ligne, ou pour une carte sans bruit |

Aucun ne demande de clé : ils sont utilisables tant que leur attribution est
affichée, ce que fait la carte en bas à droite.

Le rendu est maison — pas de bibliothèque cartographique. Les tuiles sont mises
en cache en mémoire (400 au plus, la plus ancienne cédant la place), et si elles
restent injoignables — hors ligne, ou dans un cadre qui bloque les requêtes —
la carte retombe d'elle-même sur le tracé des départements. C'est ce repli qui
permet à la page de rester utilisable partout.

### Vue inclinée

Le bouton **3D** bascule entre la vue du dessus et une vue inclinée à 55°, qui
donne la profondeur : ce qui est loin devant rétrécit, ce qui est proche
s'étale. Le choix est mémorisé.

Le plan de la carte bascule autour de son axe horizontal médian :

    z = d − dy·sin θ        profondeur du point
    facteur = d / z         rétrécissement dû à la distance

`d` est la distance focale, fixée à une fois la hauteur de la carte : plus
courte, la perspective serait plus spectaculaire mais les tuiles proches
paraîtraient étirées. La transformation est **analytiquement inversible**, ce
qui garde le clic précis et le déplacement cohérent — un pixel d'écran ne
représente pas la même distance en haut et en bas, le glissement repasse donc à
plat avant de déplacer le centre.

Une transformation affine ne sait pas produire un trapèze : chaque tuile est
découpée en huit bandes horizontales, assez fines pour être traitées comme des
parallélogrammes. Au-delà de l'horizon le plan passe derrière la caméra, un
dégradé de ciel prend le relais, et le nombre de tuiles demandées est borné —
une vue très inclinée porte sinon jusqu'à l'infini.

Il ne s'agit pas de bâtiments en volume : ceux-là demandent des tuiles
vectorielles, donc une clé d'API. C'est une mise en perspective du plan, comme
les cartes routières avant l'arrivée du rendu vectoriel.

## Hors de France

Le jeu IRVE s'arrête aux frontières. Ailleurs, l'application interroge
**OpenStreetMap** via l'API Overpass : dès que le centre de la carte sort du
territoire français, une invite propose de charger les bornes de la zone
affichée. Rien n'est embarqué — la zone est demandée à la volée, puis mise en
cache, et les stations rejoignent le même jeu de données que les françaises,
filtrables de la même manière.

L'appartenance à la France est testée sur le tracé des départements, déjà chargé
pour le fond de carte : un rectangle englobant la métropole prendrait aussi la
Belgique, la Suisse et une part de l'Allemagne, et n'y proposerait jamais les
bornes étrangères.

**Deux différences, annoncées dans l'interface :**

- **Données contributives.** Leur complétude varie fortement d'un pays et d'une
  région à l'autre. La puissance, notamment, n'est renseignée que sur une borne
  sur deux environ — un filtre de puissance masque donc les stations qui ne la
  déclarent pas.
- **Aucun état temps réel.** Il n'existe qu'en France, où le règlement AFIR
  impose sa publication. À l'étranger, seuls les horaires déclarés sont connus,
  et la fiche de station le dit explicitement.

L'API Overpass est un service public souvent saturé : trois miroirs sont
essayés tour à tour, et une zone trop vaste est refusée plutôt que de lancer une
requête vouée à expirer.

## Planifier un trajet

Le planificateur répond à la question « est-ce que je passe, et où je m'arrête ».
On choisit sa voiture, son niveau de batterie, un départ et une arrivée ; l'app
demande la route à OSRM, la parcourt en tenant le niveau de charge, et place un
arrêt dès que l'autonomie ne suffit plus pour atteindre la destination.

**Géolocalisation refusée ?** Sur iOS, chaque navigateur demande sa propre
autorisation système, rangée sous son nom dans Réglages : refuser dans Chrome
n'a rien à voir avec le réglage de Safari. Le message d'erreur détecte le
navigateur et indique le chemin correspondant, plutôt qu'un menu qui n'existe
pas là où l'utilisateur regarde.

**Vos véhicules se règlent une fois pour toutes**, dans le panneau ⚙ Réglages :
on choisit une marque, puis un modèle, on nomme le véhicule (« Ma voiture »,
« Utilitaire »), on ajuste sa consommation réelle et sa réserve. Plusieurs
véhicules peuvent coexister — voiture personnelle, second véhicule, flotte —
l'un d'eux étant actif. Tout reste dans le navigateur : rien ne sort du
téléphone.

Le planificateur affiche simplement le véhicule actif et ses caractéristiques.
L'état de charge s'y saisit indifféremment en pourcentage ou en **kilomètres
d'autonomie**, puisque c'est ce que le tableau de bord affiche ; les deux
entrées pilotent la même valeur, et la consommation corrigée est rendue au
véhicule.

**Lancer la navigation avec les arrêts.** Google Maps est le seul à accepter des
étapes intermédiaires dans une URL, et neuf au maximum : le bouton principal
ouvre donc l'itinéraire complet, arrêts compris. Waze et Plans ne prennent
qu'une destination — ils emmènent au prochain arrêt, à relancer depuis la liste
une fois sur place. Chaque étape porte ses propres liens.

**Choix des arrêts.** Seules les stations assez puissantes sont retenues (au
moins 50 kW, ou la puissance de charge de la voiture si elle est inférieure) et
dotées d'une prise que le véhicule accepte en charge rapide. Parmi elles, la
note privilégie la puissance, puis l'état réellement libre quand il est connu,
puis le faible détour ; s'arrêter tard plutôt que tôt est valorisé, cela réduit
le nombre d'arrêts. La recharge s'arrête à 80 % — au-delà elle devient trop
lente pour valoir l'attente — et le dernier arrêt ne fait le plein que du
nécessaire pour arriver avec la réserve demandée.

**Ce que le calcul ne sait pas.** C'est une estimation, pas une promesse :

- la consommation dépend de la vitesse, du relief, du chargement et surtout de
  la température (comptez 20 à 30 % de plus en hiver) — d'où le réglage manuel ;
- la puissance de charge annoncée n'est presque jamais tenue tout du long : le
  calcul retient 75 % de la puissance nominale, ce qui reste optimiste sur une
  batterie déjà bien remplie ;
- les caractéristiques des véhicules (`donnees/vehicules.js`, 64 modèles) sont
  des ordres de grandeur, pas des données constructeur ;
- une borne libre à la planification peut être occupée à l'arrivée.

La réserve à l'arrivée, réglable et fixée à 10 % par défaut, absorbe une partie
de ces écarts.

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

