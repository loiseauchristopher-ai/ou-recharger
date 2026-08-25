/* Destinations habituelles — « maison », « travail », « chez ma mere ».
 *
 * Un conducteur refait toujours les memes routes. Ce qui change d'une fois sur
 * l'autre, c'est le point de depart : on part du bureau, du parking, d'un
 * rendez-vous. C'est donc l'ARRIVEE qu'on enregistre, jamais le depart — celui
 * ci est la position du moment.
 *
 * Un depart fixe reste possible (un trajet enregistre depuis le planificateur
 * en garde un) : `depart` vaut alors un lieu au lieu de null.
 *
 * Comme le parc de vehicules, tout reste dans le navigateur.
 */
(function (global) {
  'use strict';

  var CLE = 'ou-recharger.trajets';
  var CLE_GPS = 'ou-recharger.gps';
  var MAX = 8;

  function lire() {
    var liste;
    try {
      liste = JSON.parse(localStorage.getItem(CLE) || '[]');
    } catch (e) { return []; }
    if (!Array.isArray(liste)) return [];
    /* Les enregistrements d'avant les destinations ont tous un depart fixe :
     * on les garde tels quels plutot que de leur en inventer un. */
    return liste.filter(function (t) { return t && t.nom && t.arrivee; });
  }

  function ecrire(liste) {
    try { localStorage.setItem(CLE, JSON.stringify(liste)); } catch (e) {}
    return liste;
  }

  function trouver(id) {
    var vu = null;
    lire().forEach(function (t) { if (t.id === id) vu = t; });
    return vu;
  }

  function identifiant() {
    return 't' + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36);
  }

  function poser(entree) {
    var liste = lire();
    /* Un meme nom ecrase l'ancien : on corrige son « travail » plutot que d'en
     * accumuler trois versions. */
    liste = liste.filter(function (t) {
      return t.nom.toLowerCase() !== entree.nom.toLowerCase();
    });
    liste.unshift(entree);
    return ecrire(liste.slice(0, MAX));
  }

  /* Destination simple : on part d'ou l'on est. */
  function enregistrerDestination(nom, arrivee) {
    return poser({
      id: identifiant(),
      nom: (nom || '').trim() || arrivee.libelle,
      arrivee: { lat: arrivee.lat, lon: arrivee.lon, libelle: arrivee.libelle },
      depart: null,
      distance: 0
    });
  }

  /* Trajet complet, avec son depart : ce que produit le planificateur. */
  function enregistrer(nom, depart, arrivee, distance) {
    return poser({
      id: identifiant(),
      nom: (nom || '').trim() || 'Trajet',
      arrivee: { lat: arrivee.lat, lon: arrivee.lon, libelle: arrivee.libelle },
      depart: depart ? { lat: depart.lat, lon: depart.lon, libelle: depart.libelle } : null,
      distance: distance || 0
    });
  }

  function renommer(id, nom) {
    var propre = (nom || '').trim();
    if (!propre) return lire();
    return ecrire(lire().map(function (t) {
      if (t.id === id) t.nom = propre;
      return t;
    }));
  }

  /* Le depart devient la position du moment (null) ou une adresse fixe. */
  function fixerDepart(id, depart) {
    return ecrire(lire().map(function (t) {
      if (t.id === id) t.depart = depart || null;
      return t;
    }));
  }

  /* Derniere distance reellement calculee : sert a prevenir avant le depart,
   * sans rappeler le service de routage. */
  function memoriser(id, distance) {
    return ecrire(lire().map(function (t) {
      if (t.id === id) t.distance = distance;
      return t;
    }));
  }

  function supprimer(id) {
    return ecrire(lire().filter(function (t) { return t.id !== id; }));
  }

  function deplacer(id, sens) {
    var liste = lire();
    var rang = -1;
    liste.forEach(function (t, k) { if (t.id === id) rang = k; });
    var vise = rang + sens;
    if (rang < 0 || vise < 0 || vise >= liste.length) return liste;
    var bouge = liste.splice(rang, 1)[0];
    liste.splice(vise, 0, bouge);
    return ecrire(liste);
  }

  /* Application de navigation preferee : elle decide de ce qui s'ouvre au
   * toucher d'une destination, sans question posee au moment de partir. */
  function gps() {
    try { return localStorage.getItem(CLE_GPS) || 'Waze'; } catch (e) { return 'Waze'; }
  }

  function fixerGps(nom) {
    try { localStorage.setItem(CLE_GPS, nom); } catch (e) {}
    return nom;
  }

  global.Bornes.trajetsEnregistres = {
    lire: lire, trouver: trouver,
    enregistrer: enregistrer, enregistrerDestination: enregistrerDestination,
    renommer: renommer, fixerDepart: fixerDepart, memoriser: memoriser,
    supprimer: supprimer, deplacer: deplacer,
    gps: gps, fixerGps: fixerGps
  };
})(window);
