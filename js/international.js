/* Bornes hors de France, via OpenStreetMap.
 *
 * Le jeu IRVE s'arrete aux frontieres francaises. Ailleurs, la source ouverte
 * de reference est OpenStreetMap, interroge par l'API Overpass. On n'embarque
 * rien : la zone affichee est demandee a la volee, puis mise en cache.
 *
 * Deux differences a garder en tete, et que l'interface annonce :
 *   - les donnees sont contributives, donc inegales selon les pays ;
 *   - aucun etat temps reel n'existe hors de France, ou seul le reglement AFIR
 *     impose sa publication.
 */
(function (global) {
  'use strict';

  var B = global.Bornes;

  /* Plusieurs miroirs : le service est public et frequemment sature. */
  var MIROIRS = [
    'https://lz4.overpass-api.de/api/interpreter',
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter'
  ];

  var DELAI_MAX = 40000;
  var SURFACE_MAX = 4.0;        // degres carres — au-dela, on demande de zoomer
  var PLAFOND = 3000;           // bornes par requete

  var cache = [];               // zones deja recuperees

  /* ------------------------------------------------- Lecture des etiquettes */

  /* « 11 kW », « 11kW », « 22 », « 22,1 », « 7.2 kW », « 50000 W ». */
  function puissance(valeur) {
    if (!valeur) return 0;
    var m = /(\d+(?:[.,]\d+)?)/.exec(String(valeur));
    if (!m) return 0;
    var n = parseFloat(m[1].replace(',', '.'));
    if (!isFinite(n)) return 0;
    if (/\bw\b/i.test(valeur) && !/kw/i.test(valeur) && n > 1000) n = n / 1000;
    return n > 0 && n < 1000 ? n : 0;
  }

  function estVrai(v) {
    return v !== undefined && v !== 'no' && v !== 'false' && v !== '0';
  }

  var PRISES_OSM = [
    ['socket:type2', B.PRISE.T2],
    ['socket:type2_cable', B.PRISE.T2],
    ['socket:type2_combo', B.PRISE.CCS],
    ['socket:chademo', B.PRISE.CHADEMO],
    ['socket:typee', B.PRISE.EF],
    ['socket:type_e', B.PRISE.EF],
    ['socket:schuko', B.PRISE.EF],
    ['socket:type3c', B.PRISE.AUTRE],
    ['socket:tesla_supercharger', B.PRISE.AUTRE]
  ];

  function convertir(element) {
    var t = element.tags || {};
    var lat = element.lat != null ? element.lat : (element.center && element.center.lat);
    var lon = element.lon != null ? element.lon : (element.center && element.center.lon);
    if (lat == null || lon == null) return null;

    var prises = 0, kw = 0;
    for (var i = 0; i < PRISES_OSM.length; i++) {
      var cle = PRISES_OSM[i][0];
      if (!estVrai(t[cle])) continue;
      prises |= PRISES_OSM[i][1];
      kw = Math.max(kw, puissance(t[cle + ':output']));
    }
    kw = Math.max(kw, puissance(t['charging_station:output']), puissance(t.output));

    var points = parseInt(t.capacity, 10);
    if (!isFinite(points) || points <= 0) points = 1;

    var reseau = t.brand || t.network || t.operator || t.name || 'Réseau non précisé';
    var acces = (t.access || '').toLowerCase();

    var drapeaux = 0;
    if (t.fee === 'no') drapeaux |= B.DRAPEAU.GRATUIT;
    if (estVrai(t['payment:credit_cards']) || estVrai(t['payment:debit_cards'])) {
      drapeaux |= B.DRAPEAU.CB;
    }
    if (/^24\/7$/.test((t.opening_hours || '').trim())) drapeaux |= B.DRAPEAU.H24;
    if (acces === 'yes' || acces === 'public' || acces === 'permissive') {
      drapeaux |= B.DRAPEAU.ACCES_LIBRE;
    }
    if (estVrai(t.wheelchair) && t.wheelchair !== 'limited') drapeaux |= B.DRAPEAU.PMR;
    if (estVrai(t.motorcycle) || estVrai(t.scooter)) drapeaux |= B.DRAPEAU.DEUX_ROUES;

    var nom = t.name || t.operator || '';
    var adresse = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');

    return {
      lat: lat, lon: lon, kw: kw, points: Math.min(points, 65535),
      reseau: String(reseau).slice(0, 60), nom: String(nom).slice(0, 70),
      adresse: adresse, cp: t['addr:postcode'] || '', ville: t['addr:city'] || '',
      prises: prises, drapeaux: drapeaux,
      horaires: t.opening_hours || '',
      source: 'osm'
    };
  }

  /* ------------------------------------------------------------- Requetes */

  function requete(bbox) {
    /* bbox : [lonMin, latMin, lonMax, latMax] — Overpass attend sud,ouest,nord,est. */
    var zone = bbox[1] + ',' + bbox[0] + ',' + bbox[3] + ',' + bbox[2];
    return '[out:json][timeout:50];(' +
      'node["amenity"="charging_station"](' + zone + ');' +
      'way["amenity"="charging_station"](' + zone + ');' +
      ');out tags center ' + PLAFOND + ';';
  }

  function interroger(bbox, miroir) {
    miroir = miroir || 0;
    if (miroir >= MIROIRS.length) {
      return Promise.reject(new Error('service OpenStreetMap injoignable'));
    }
    var stop = typeof AbortController === 'function' ? new AbortController() : null;
    var minuteur = setTimeout(function () { if (stop) stop.abort(); }, DELAI_MAX);

    return fetch(MIROIRS[miroir], {
      method: 'POST',
      body: 'data=' + encodeURIComponent(requete(bbox)),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: stop && stop.signal
    }).then(function (r) {
      clearTimeout(minuteur);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).catch(function () {
      clearTimeout(minuteur);
      return interroger(bbox, miroir + 1);       // miroir suivant
    });
  }

  function surface(bbox) {
    return Math.abs(bbox[2] - bbox[0]) * Math.abs(bbox[3] - bbox[1]);
  }

  function dejaCouvert(bbox) {
    for (var i = 0; i < cache.length; i++) {
      var z = cache[i];
      if (bbox[0] >= z[0] && bbox[1] >= z[1] && bbox[2] <= z[2] && bbox[3] <= z[3]) return true;
    }
    return false;
  }

  /* Renvoie { stations, deja } pour la zone demandee. */
  function charger(bbox) {
    if (surface(bbox) > SURFACE_MAX) {
      return Promise.reject(new Error('zone trop vaste — rapprochez-vous d’abord'));
    }
    if (dejaCouvert(bbox)) return Promise.resolve({ stations: [], deja: true });

    return interroger(bbox).then(function (json) {
      if (!json || !json.elements) throw new Error('réponse inattendue');
      cache.push(bbox.slice());
      var stations = [];
      for (var i = 0; i < json.elements.length; i++) {
        var s = convertir(json.elements[i]);
        if (s) stations.push(s);
      }
      return { stations: stations, deja: false, tronque: json.elements.length >= PLAFOND };
    });
  }

  function oublier() { cache = []; }

  global.Bornes.international = {
    charger: charger,
    oublier: oublier,
    convertir: convertir,
    puissance: puissance,
    SURFACE_MAX: SURFACE_MAX
  };
})(window);
