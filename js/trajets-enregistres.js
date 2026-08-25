/* Trajets habituels de l'utilisateur.
 *
 * Un conducteur refait toujours les memes routes : domicile, travail, la
 * famille. Les retaper a chaque fois n'a pas de sens — on les enregistre, et
 * l'accueil les propose en une touche.
 *
 * Comme le parc de vehicules, tout reste dans le navigateur.
 */
(function (global) {
  'use strict';

  var CLE = 'ou-recharger.trajets';

  function lire() {
    try {
      var liste = JSON.parse(localStorage.getItem(CLE) || '[]');
      return Array.isArray(liste) ? liste : [];
    } catch (e) { return []; }
  }

  function ecrire(liste) {
    try { localStorage.setItem(CLE, JSON.stringify(liste)); } catch (e) {}
    return liste;
  }

  function identifiant() {
    return 't' + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36);
  }

  function enregistrer(nom, depart, arrivee, distance) {
    var liste = lire();
    /* Un même nom écrase l'ancien : on corrige son « travail » plutôt que d'en
     * accumuler trois versions. */
    var propre = (nom || '').trim() || 'Trajet';
    liste = liste.filter(function (t) {
      return t.nom.toLowerCase() !== propre.toLowerCase();
    });
    liste.unshift({
      id: identifiant(), nom: propre,
      depart: { lat: depart.lat, lon: depart.lon, libelle: depart.libelle },
      arrivee: { lat: arrivee.lat, lon: arrivee.lon, libelle: arrivee.libelle },
      /* La distance permet de prévenir avant le départ, sans recalculer. */
      distance: distance || 0
    });
    return ecrire(liste.slice(0, 8));
  }

  function supprimer(id) {
    return ecrire(lire().filter(function (t) { return t.id !== id; }));
  }

  global.Bornes.trajetsEnregistres = {
    lire: lire, enregistrer: enregistrer, supprimer: supprimer
  };
})(window);
