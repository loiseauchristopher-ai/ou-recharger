/* Disponibilite des points de charge.
 *
 * Deux niveaux, volontairement distincts pour ne pas faire passer l'un pour l'autre :
 *
 *   1. « Ouvert maintenant » : deduit du champ horaires du jeu IRVE. Couvre toute la
 *      France, mais ne dit rien de l'occupation reelle des bornes.
 *   2. « Libre maintenant » : statut temps reel des points de charge, quand un
 *      operateur publie un flux ouvert. Aujourd'hui un seul le fait de maniere
 *      exploitable sans cle : Belib' (Ville de Paris). Les autres reseaux passent
 *      par des flux OCPI prives — d'ou le registre extensible ci-dessous.
 */
(function (global) {
  'use strict';

  var STATUTS = {
    'disponible': 'libre',
    'occupe (en charge)': 'occupe',
    'occupé (en charge)': 'occupe',
    'en charge': 'occupe',
    'reserve': 'occupe',
    'en maintenance': 'hs',
    'hors service': 'hs',
    'supprime': 'hs',
    'mise en service planifiee': 'hs',
    'mise en service planifiée': 'hs'
  };

  function normaliserStatut(brut) {
    var s = (brut || '').trim().toLowerCase();
    return STATUTS[s] || 'inconnu';
  }

  /* --------------------------------------------------------- Fournisseurs */

  var FOURNISSEURS = [{
    id: 'belib',
    nom: "Belib' — Ville de Paris",
    /* [lonMin, latMin, lonMax, latMax] */
    zone: [2.20, 48.78, 2.50, 48.93],
    url: 'https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/' +
      'belib-points-de-recharge-pour-vehicules-electriques-disponibilite-temps-reel' +
      '/exports/json?limit=-1&select=id_pdc,statut_pdc,last_updated,coordonneesxy',
    lire: function (json) {
      return json.map(function (r) {
        var xy = r.coordonneesxy || {};
        return {
          lat: xy.lat, lon: xy.lon,
          statut: normaliserStatut(r.statut_pdc),
          maj: r.last_updated
        };
      }).filter(function (p) { return p.lat && p.lon; });
    }
  }];

  function chevauche(zone, bbox) {
    return !(bbox[0] > zone[2] || bbox[2] < zone[0] ||
             bbox[1] > zone[3] || bbox[3] < zone[1]);
  }

  /* ------------------------------------------------------------- Cache/API */

  var cache = {};                    // id fournisseur -> { a: horodatage, points: [] }
  var DUREE_CACHE = 60 * 1000;
  var DELAI_MAX = 8000;

  function chargerFournisseur(f) {
    var c = cache[f.id];
    if (c && Date.now() - c.a < DUREE_CACHE) return Promise.resolve(c.points);

    /* Sans garde-fou, un reseau bloque (proxy, hors ligne, CSP) laisse la
     * promesse en suspens et l'interface affiche « chargement » pour toujours. */
    var stop = typeof AbortController === 'function' ? new AbortController() : null;
    var minuteur = setTimeout(function () { if (stop) stop.abort(); }, DELAI_MAX);
    var expire = new Promise(function (_, rejeter) {
      setTimeout(function () { rejeter(new Error('délai dépassé')); }, DELAI_MAX + 200);
    });

    return Promise.race([expire, fetch(f.url, { mode: 'cors', signal: stop && stop.signal })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (j) {
        var points = f.lire(j);
        cache[f.id] = { a: Date.now(), points: points };
        return points;
      })]).then(function (points) {
        clearTimeout(minuteur);
        return points;
      }, function (e) {
        clearTimeout(minuteur);
        throw e;
      });
  }

  /* Renvoie { points, fournisseurs, erreurs } pour la zone visible. */
  function rafraichir(bbox) {
    var concernes = FOURNISSEURS.filter(function (f) { return chevauche(f.zone, bbox); });
    if (!concernes.length) {
      return Promise.resolve({ points: [], fournisseurs: [], erreurs: [], horsZone: true });
    }
    var erreurs = [];
    return Promise.all(concernes.map(function (f) {
      return chargerFournisseur(f).catch(function (e) {
        erreurs.push({ fournisseur: f.nom, message: e.message });
        return [];
      });
    })).then(function (lots) {
      return {
        points: [].concat.apply([], lots),
        fournisseurs: concernes.filter(function (f, i) { return lots[i].length; }),
        erreurs: erreurs,
        horsZone: false
      };
    });
  }

  /* --------------------------------------------------------- Appariement */

  /* Les flux temps reel n'exposent pas d'identifiant de station IRVE fiable : on
   * rattache par la geographie. Chaque point de charge rejoint la station la
   * plus proche dans un rayon serre — en centre-ville dense, un rayon large
   * accrochait les bornes du trottoir d'en face et faisait afficher plus de
   * points libres que la station n'en compte. */
  var RAYON_APPARIEMENT_M = 80;

  function apparier(jeu, points, rayonM) {
    var rayon = rayonM || RAYON_APPARIEMENT_M;
    var pas = 0.002;                                  // ~220 m en latitude
    var grille = new Map();

    /* Index des stations, pour ne comparer qu'aux cellules voisines. */
    for (var s = 0; s < jeu.taille; s++) {
      var k = Math.round(jeu.lat[s] / 1e5 / pas) + ':' + Math.round(jeu.lon[s] / 1e5 / pas);
      var lot = grille.get(k);
      if (lot) lot.push(s); else grille.set(k, [s]);
    }

    var parStation = new Map();
    for (var i = 0; i < points.length; i++) {
      var p = points[i];
      var ci = Math.round(p.lat / pas), cj = Math.round(p.lon / pas);
      var meilleure = -1, meilleureDistance = Infinity;
      for (var di = -1; di <= 1; di++) {
        for (var dj = -1; dj <= 1; dj++) {
          var candidats = grille.get((ci + di) + ':' + (cj + dj));
          if (!candidats) continue;
          for (var c = 0; c < candidats.length; c++) {
            var st = candidats[c];
            var d = global.Bornes.distanceKm(
              jeu.lat[st] / 1e5, jeu.lon[st] / 1e5, p.lat, p.lon) * 1000;
            if (d < meilleureDistance) { meilleureDistance = d; meilleure = st; }
          }
        }
      }
      if (meilleure < 0 || meilleureDistance > rayon) continue;

      var etat = parStation.get(meilleure);
      if (!etat) {
        etat = { libre: 0, occupe: 0, hs: 0, inconnu: 0, total: 0, maj: null };
        parStation.set(meilleure, etat);
      }
      etat[p.statut]++;
      etat.total++;
      if (p.maj && (!etat.maj || p.maj > etat.maj)) etat.maj = p.maj;
    }
    return parStation;
  }

  global.Bornes = global.Bornes || {};
  global.Bornes.dispo = {
    fournisseurs: FOURNISSEURS,
    rafraichir: rafraichir,
    apparier: apparier,
    normaliserStatut: normaliserStatut,
    chevauche: chevauche
  };
})(window);
