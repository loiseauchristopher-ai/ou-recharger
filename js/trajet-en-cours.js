/* Suivi d'un trajet commence.
 *
 * Waze et Plans n'acceptent qu'une destination : on y part pour le prochain
 * arret, on recharge, puis il faut relancer. Sans memoire, l'application
 * redemanderait tout le trajet a chaque retour.
 *
 * On garde donc le plan en cours et l'arret vise. Au retour, la position — si
 * elle est connue — dit ou l'on en est ; sinon l'utilisateur le confirme d'une
 * touche. Rien n'est deviné en silence.
 */
(function (global) {
  'use strict';

  var CLE = 'ou-recharger.trajet-en-cours';
  var DUREE_VIE = 24 * 60 * 60 * 1000;   // au-dela, le trajet est oublie
  var RAYON_ARRIVEE_KM = 2.5;            // on se considere « sur place » en deca

  function lire() {
    var brut = null;
    try { brut = JSON.parse(localStorage.getItem(CLE) || 'null'); } catch (e) { return null; }
    if (!brut || !brut.etapes || !brut.debut) return null;
    if (Date.now() - brut.debut > DUREE_VIE) { oublier(); return null; }
    return brut;
  }

  function ecrire(suivi) {
    try { localStorage.setItem(CLE, JSON.stringify(suivi)); } catch (e) {}
    return suivi;
  }

  function oublier() {
    try { localStorage.removeItem(CLE); } catch (e) {}
  }

  /* Les arrets sont gardes par coordonnees, pas par indice : le jeu de donnees
   * grandit quand on charge une zone etrangere, et les indices bougeraient. */
  function demarrer(plan, lieux, jeu) {
    return ecrire({
      debut: Date.now(),
      arrivee: { lat: lieux[1].lat, lon: lieux[1].lon, libelle: lieux[1].libelle },
      distance: plan.distance,
      etapeVisee: 0,
      faites: [],
      etapes: plan.etapes.map(function (e) {
        return {
          lat: jeu.latitude(e.station), lon: jeu.longitude(e.station),
          nom: jeu.libelle(e.station), reseau: jeu.reseaux[jeu.reseau[e.station]],
          kw: jeu.kw(e.station), km: e.km, minutes: e.minutes,
          chargeDepart: e.chargeDepart
        };
      })
    });
  }

  function viser(rang) {
    var suivi = lire();
    if (!suivi) return null;
    suivi.etapeVisee = rang;
    return ecrire(suivi);
  }

  function marquerFaite(rang) {
    var suivi = lire();
    if (!suivi) return null;
    if (suivi.faites.indexOf(rang) < 0) suivi.faites.push(rang);
    suivi.etapeVisee = Math.min(rang + 1, suivi.etapes.length);
    return ecrire(suivi);
  }

  /* Prochaine etape non faite, ou null s'il ne reste que la destination. */
  function prochaine(suivi) {
    for (var i = 0; i < suivi.etapes.length; i++) {
      if (suivi.faites.indexOf(i) < 0) return { rang: i, etape: suivi.etapes[i] };
    }
    return null;
  }

  /* Confronte la position a la liste des arrets. Renvoie l'arret sur lequel on
   * se trouve, la destination si elle est atteinte, ou null. */
  function situer(suivi, lat, lon) {
    var distanceKm = global.Bornes.distanceKm;
    if (distanceKm(lat, lon, suivi.arrivee.lat, suivi.arrivee.lon) <= RAYON_ARRIVEE_KM) {
      return { arrive: true };
    }
    var meilleur = null;
    for (var i = 0; i < suivi.etapes.length; i++) {
      var d = distanceKm(lat, lon, suivi.etapes[i].lat, suivi.etapes[i].lon);
      if (d <= RAYON_ARRIVEE_KM && (!meilleur || d < meilleur.distance)) {
        meilleur = { rang: i, etape: suivi.etapes[i], distance: d };
      }
    }
    return meilleur;
  }

  global.Bornes.trajetEnCours = {
    lire: lire, demarrer: demarrer, viser: viser, marquerFaite: marquerFaite,
    prochaine: prochaine, situer: situer, oublier: oublier,
    RAYON_ARRIVEE_KM: RAYON_ARRIVEE_KM
  };
})(window);
