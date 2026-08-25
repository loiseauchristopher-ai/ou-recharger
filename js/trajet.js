/* Planification d'un trajet avec arrets de recharge.
 *
 * Le principe : on demande la route a OSRM, on la parcourt en tenant le niveau
 * de batterie, et des que l'autonomie ne suffit plus pour atteindre l'arrivee,
 * on choisit une station accessible avant la panne.
 *
 * Tout ici est une ESTIMATION. La consommation reelle depend de la vitesse, du
 * relief, du chargement et de la temperature ; la puissance de charge chute a
 * mesure que la batterie se remplit. Le calcul garde donc une reserve, s'arrete
 * a 80 % (au-dela le gain de temps est negatif) et annonce ses hypotheses
 * plutot que de promettre une precision qu'il n'a pas.
 */
(function (global) {
  'use strict';

  var B = global.Bornes;

  var ROUTAGE = 'https://router.project-osrm.org/route/v1/driving/';
  var CHARGE_CIBLE = 80;          // % — au-dela, la recharge devient tres lente
  var RENDEMENT = 0.75;           // part de la puissance nominale reellement tenue
  var ETAPES_MAX = 12;

  /* ------------------------------------------------------------- Routage */

  function itineraire(depart, arrivee) {
    var url = ROUTAGE + depart.lon + ',' + depart.lat + ';' +
      arrivee.lon + ',' + arrivee.lat + '?overview=full&geometries=geojson';
    return fetch(url)
      .then(function (r) {
        if (!r.ok) throw new Error('service de routage indisponible (HTTP ' + r.status + ')');
        return r.json();
      })
      .then(function (j) {
        if (j.code !== 'Ok' || !j.routes || !j.routes.length) {
          throw new Error('aucune route trouvée entre ces deux points');
        }
        var route = j.routes[0];
        return {
          points: route.geometry.coordinates,     // [lon, lat]
          distance: route.distance / 1000,        // km
          duree: route.duration / 60              // minutes
        };
      });
  }

  /* Points de la route espaces d'environ `pas` km, avec leur distance cumulee.
   * Sert a la fois au calcul d'autonomie et a la recherche de stations. */
  function jalonner(points, pas) {
    var jalons = [];
    var cumul = 0;
    var dernier = null;
    for (var i = 0; i < points.length; i++) {
      var lon = points[i][0], lat = points[i][1];
      if (dernier) cumul += B.distanceKm(dernier[1], dernier[0], lat, lon);
      dernier = points[i];
      if (!jalons.length || cumul - jalons[jalons.length - 1].km >= pas) {
        jalons.push({ km: cumul, lat: lat, lon: lon });
      }
    }
    if (jalons.length && cumul - jalons[jalons.length - 1].km > 0.01) {
      jalons.push({ km: cumul, lat: dernier[1], lon: dernier[0] });
    }
    return jalons;
  }

  /* ------------------------------------- Stations le long de l'itineraire */

  /* Indexe les stations retenues par cellule, puis associe a chacune sa
   * position le long de la route et son detour approximatif. */
  function stationsSurLaRoute(jeu, indices, jalons, detourMax) {
    var pas = 0.05;                                  // ~5,5 km en latitude
    var grille = new Map();
    for (var k = 0; k < indices.length; k++) {
      var s = indices[k];
      var cle = Math.round(jeu.lat[s] / 1e5 / pas) + ':' + Math.round(jeu.lon[s] / 1e5 / pas);
      var lot = grille.get(cle);
      if (lot) lot.push(s); else grille.set(cle, [s]);
    }

    var vues = new Map();
    var portee = Math.ceil(detourMax / 5.5);
    for (var j = 0; j < jalons.length; j++) {
      var jal = jalons[j];
      var ci = Math.round(jal.lat / pas), cj = Math.round(jal.lon / pas);
      for (var di = -portee; di <= portee; di++) {
        for (var dj = -portee; dj <= portee; dj++) {
          var candidats = grille.get((ci + di) + ':' + (cj + dj));
          if (!candidats) continue;
          for (var c = 0; c < candidats.length; c++) {
            var st = candidats[c];
            var d = B.distanceKm(jal.lat, jal.lon, jeu.lat[st] / 1e5, jeu.lon[st] / 1e5);
            if (d > detourMax) continue;
            var connue = vues.get(st);
            if (!connue || d < connue.detour) {
              vues.set(st, { station: st, detour: d, km: jal.km });
            }
          }
        }
      }
    }
    var liste = Array.from(vues.values());
    liste.sort(function (a, b) { return a.km - b.km; });
    return liste;
  }

  /* ------------------------------------------------------- Choix d'un arret */

  /* Note une station candidate : la puissance prime (elle determine le temps
   * passe sur place), puis l'etat reellement connu, puis le detour. */
  function noter(candidate, jeu, etatTempsReel, portee, depuis) {
    var kw = jeu.kw(candidate.station);
    if (kw <= 0) return -1;

    var note = Math.min(kw, 300) / 3;                       // 0 a 100
    note -= candidate.detour * 4;                           // 4 points par km de detour

    /* Mieux vaut s'arreter tard que tot : cela reduit le nombre d'arrets. */
    var avancement = (candidate.km - depuis) / portee;
    note += avancement * 25;

    var e = etatTempsReel && etatTempsReel.get(candidate.station);
    if (e && B.dispo.estFrais(e)) {
      if (e.libre) note += 30;
      else if (e.hs && !e.libre && !e.occupe) note -= 60;
      else if (e.occupe) note -= 15;
    }
    if (jeu.points[candidate.station] >= 4) note += 8;       // moins de risque d'attente
    return note;
  }

  function minutesDeCharge(vehicule, station, jeu, depuis, vers) {
    var energie = vehicule.batterie * (vers - depuis) / 100;
    var puissance = Math.min(vehicule.charge, jeu.kw(station) || vehicule.charge) * RENDEMENT;
    if (puissance <= 0) return null;
    return Math.round(energie / puissance * 60);
  }

  /* ------------------------------------------------------------ Planification */

  /* Renvoie { etapes, distance, autonomieDepart, alerte } ou leve une erreur
   * explicite si aucune station ne permet de poursuivre. */
  function planifier(options) {
    var jeu = options.jeu;
    var vehicule = options.vehicule;
    var jalons = options.jalons;
    var candidates = options.candidates;
    var etatTempsReel = options.tempsReel;
    var reserve = options.reserve != null ? options.reserve : 10;
    var charge = options.chargeDepart;
    var total = jalons[jalons.length - 1].km;

    function porteeKm(pourcent) {
      return vehicule.batterie * Math.max(0, pourcent - reserve) / 100 / vehicule.conso * 100;
    }

    /* Part de batterie consommee sur `km`, en points de pourcentage. */
    function coutEnPourcent(km) {
      return km * vehicule.conso / vehicule.batterie;
    }

    var autonomieDepart = porteeKm(charge);
    var etapes = [];
    var position = 0;

    while (etapes.length < ETAPES_MAX) {
      var portee = porteeKm(charge);
      var restant = total - position;
      if (portee >= restant) {
        return {
          etapes: etapes,
          distance: total,
          autonomieDepart: autonomieDepart,
          chargeArrivee: charge - coutEnPourcent(restant)
        };
      }

      /* Fenetre d'arret : pas trop tot pour limiter le nombre d'etapes, pas
       * au-dela de ce que la batterie permet d'atteindre. */
      var limite = position + portee;
      var minimum = position + Math.max(portee * 0.45, 15);
      var meilleure = null, meilleureNote = -Infinity;

      for (var i = 0; i < candidates.length; i++) {
        var c = candidates[i];
        if (c.km <= minimum || c.km > limite) continue;
        var note = noter(c, jeu, etatTempsReel, portee, position);
        if (note > meilleureNote) { meilleureNote = note; meilleure = c; }
      }

      /* Rien dans la fenetre ideale : on accepte un arret plus precoce. */
      if (!meilleure) {
        for (var j = 0; j < candidates.length; j++) {
          var d = candidates[j];
          if (d.km <= position + 5 || d.km > limite) continue;
          var n = noter(d, jeu, etatTempsReel, portee, position);
          if (n > meilleureNote) { meilleureNote = n; meilleure = d; }
        }
      }

      if (!meilleure) {
        var e = new Error('Aucune station atteignable entre le kilomètre ' +
          Math.round(position) + ' et le kilomètre ' + Math.round(limite) +
          ' avec les filtres actuels.');
        e.etapes = etapes;
        e.position = position;
        throw e;
      }

      var parcouru = meilleure.km - position;
      var arrivee = charge - coutEnPourcent(parcouru);

      /* Inutile de charger a 80 % si le reste du trajet demande moins : on ne
       * remplit que le necessaire, plus la reserve. */
      var besoin = coutEnPourcent(total - meilleure.km) + reserve;
      var cible = Math.min(CHARGE_CIBLE, Math.max(besoin + 5, arrivee + 10));
      if (cible <= arrivee) cible = Math.min(CHARGE_CIBLE, arrivee + 10);

      etapes.push({
        station: meilleure.station,
        km: meilleure.km,
        detour: meilleure.detour,
        chargeArrivee: Math.max(0, arrivee),
        chargeDepart: cible,
        minutes: minutesDeCharge(vehicule, meilleure.station, jeu, arrivee, cible)
      });

      position = meilleure.km;
      charge = cible;
    }

    var trop = new Error('Trajet trop long pour être planifié en ' + ETAPES_MAX + ' arrêts.');
    trop.etapes = etapes;
    throw trop;
  }

  global.Bornes = global.Bornes || {};
  global.Bornes.trajet = {
    itineraire: itineraire,
    jalonner: jalonner,
    stationsSurLaRoute: stationsSurLaRoute,
    planifier: planifier,
    CHARGE_CIBLE: CHARGE_CIBLE
  };
})(window);
