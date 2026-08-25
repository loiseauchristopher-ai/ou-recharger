/* Disponibilite des points de charge.
 *
 * Deux niveaux, volontairement distincts pour ne pas faire passer l'un pour
 * l'autre :
 *
 *   1. « Ouvert maintenant » : deduit du champ horaires du jeu IRVE. Couvre
 *      toute la France, mais ne dit rien de l'occupation reelle des bornes.
 *   2. « Libre maintenant » : etat et occupation reellement remontes par les
 *      operateurs, via la base nationale consolidee dynamique publiee par le
 *      Point d'Acces National (transport.data.gouv.fr). Le reglement europeen
 *      AFIR impose desormais cette publication : ~115 000 points de charge y
 *      figurent, dont Belib' a Paris.
 *
 * Le rattachement se fait par identifiant d'itinerance — pas par proximite
 * geographique — ce qui evite d'attribuer a une station les bornes du trottoir
 * d'en face. 97 % des points du flux trouvent ainsi leur station.
 *
 * La fraicheur est tres inegale d'un operateur a l'autre : la moitie des points
 * datent de moins de six heures, un quart de moins d'une heure. Un etat ancien
 * est donc presente comme tel, jamais comme du temps reel.
 */
(function (global) {
  'use strict';

  var SOURCE = {
    nom: 'Base nationale IRVE dynamique — transport.data.gouv.fr',
    donnees: 'https://proxy.transport.data.gouv.fr/resource/consolidation-nationale-irve-dynamique',
    index: 'donnees/index-itinerance.js'
  };

  /* Au-dela, l'etat n'est plus du temps reel mais un dernier etat connu. */
  var FRAICHEUR_MS = 2 * 60 * 60 * 1000;
  var DUREE_CACHE = 3 * 60 * 1000;
  var DELAI_MAX = 45000;

  var cache = { a: 0, parStation: null, resume: null };
  var indexPromesse = null;

  /* ------------------------------------------------- Index d'itinerance */

  /* Charge la table identifiant -> station. Volumineuse (~580 Ko compressee),
   * donc jamais chargee tant que l'utilisateur ne demande pas le temps reel. */
  function chargerIndex() {
    if (global.INDEX_ITINERANCE) return Promise.resolve(global.INDEX_ITINERANCE);
    if (indexPromesse) return indexPromesse;

    indexPromesse = new Promise(function (resoudre, rejeter) {
      var balise = document.createElement('script');
      balise.src = SOURCE.index;
      balise.onload = function () {
        if (global.INDEX_ITINERANCE) resoudre(global.INDEX_ITINERANCE);
        else rejeter(new Error('index d’itinérance illisible'));
      };
      balise.onerror = function () { rejeter(new Error('index d’itinérance injoignable')); };
      document.head.appendChild(balise);
    });
    indexPromesse.catch(function () { indexPromesse = null; });
    return indexPromesse;
  }

  function tableIdentifiants(index) {
    if (index._table) return index._table;
    var table = new Map();
    for (var i = 0; i < index.ids.length; i++) table.set(index.ids[i], index.stations[i]);
    index._table = table;
    return table;
  }

  /* ------------------------------------------------------ Flux dynamique */

  var ETATS = { libre: 'libre', occupe: 'occupe', reserve: 'occupe' };

  /* Analyse le CSV du flux. Colonnes : id_pdc_itinerance, etat_pdc,
   * occupation_pdc, horodatage, puis l'etat par type de prise. */
  function analyser(csv, table) {
    var lignes = csv.split('\n');
    var parStation = new Map();
    var total = 0, appariés = 0, plusRecent = 0;

    for (var i = 1; i < lignes.length; i++) {
      var ligne = lignes[i];
      if (!ligne) continue;
      var champs = ligne.split(',');
      if (champs.length < 4) continue;
      total++;

      var station = table.get(champs[0].trim().toUpperCase());
      if (station === undefined) continue;
      appariés++;

      var etat = parStation.get(station);
      if (!etat) {
        etat = { libre: 0, occupe: 0, hs: 0, inconnu: 0, total: 0, maj: 0 };
        parStation.set(station, etat);
      }

      var horodatage = Date.parse((champs[3] || '').trim().replace(' ', 'T'));
      if (horodatage && horodatage > etat.maj) etat.maj = horodatage;
      if (horodatage > plusRecent) plusRecent = horodatage;

      etat.total++;
      if ((champs[1] || '').trim() === 'hors_service') {
        etat.hs++;
      } else {
        var occupation = ETATS[(champs[2] || '').trim()];
        if (occupation) etat[occupation]++; else etat.inconnu++;
      }
    }

    return {
      parStation: parStation,
      resume: {
        source: SOURCE.nom,
        points: total,
        appariés: appariés,
        stations: parStation.size,
        plusRecent: plusRecent
      }
    };
  }

  function telecharger(url) {
    var stop = typeof AbortController === 'function' ? new AbortController() : null;
    var minuteur = setTimeout(function () { if (stop) stop.abort(); }, DELAI_MAX);
    return fetch(url, { mode: 'cors', signal: stop && stop.signal })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function (texte) { clearTimeout(minuteur); return texte; },
            function (e) { clearTimeout(minuteur); throw e; });
  }

  /* Renvoie { parStation, resume } ; rejette si le flux est injoignable. */
  function rafraichir() {
    if (cache.parStation && Date.now() - cache.a < DUREE_CACHE) {
      return Promise.resolve({ parStation: cache.parStation, resume: cache.resume });
    }
    return Promise.all([chargerIndex(), telecharger(SOURCE.donnees)])
      .then(function (r) {
        var resultat = analyser(r[1], tableIdentifiants(r[0]));
        cache = { a: Date.now(), parStation: resultat.parStation, resume: resultat.resume };
        return resultat;
      });
  }

  /* Un etat suffisamment recent pour etre presente comme du temps reel. */
  function estFrais(etat) {
    return !!etat && !!etat.maj && (Date.now() - etat.maj) < FRAICHEUR_MS;
  }

  /* « il y a 40 min », « il y a 3 h », « il y a 2 j » */
  function anciennete(horodatage) {
    if (!horodatage) return '';
    var minutes = Math.round((Date.now() - horodatage) / 60000);
    if (minutes < 2) return 'à l’instant';
    if (minutes < 60) return 'il y a ' + minutes + ' min';
    var heures = Math.round(minutes / 60);
    if (heures < 36) return 'il y a ' + heures + ' h';
    return 'il y a ' + Math.round(heures / 24) + ' j';
  }

  global.Bornes = global.Bornes || {};
  global.Bornes.dispo = {
    source: SOURCE,
    rafraichir: rafraichir,
    estFrais: estFrais,
    anciennete: anciennete,
    FRAICHEUR_MS: FRAICHEUR_MS
  };
})(window);
