/* Le parc de vehicules de l'utilisateur.
 *
 * On ne configure pas sa voiture a chaque trajet : elle est enregistree une
 * fois, avec la consommation qu'on lui connait, et retrouvee ensuite. Plusieurs
 * vehicules peuvent coexister — voiture personnelle, utilitaire, flotte — l'un
 * d'eux etant actif.
 *
 * Tout est garde dans le navigateur : aucune donnee ne sort du telephone.
 */
(function (global) {
  'use strict';

  var CLE = 'ou-recharger.parc';
  var CLE_ANCIENNE = 'ou-recharger.vehicule';

  function lireBrut(cle) {
    try { return JSON.parse(localStorage.getItem(cle) || 'null'); } catch (e) { return null; }
  }

  function ecrire(parc) {
    try { localStorage.setItem(CLE, JSON.stringify(parc)); } catch (e) { /* privé */ }
    return parc;
  }

  function vide() { return { vehicules: [], actif: null }; }

  /* Reprend l'unique vehicule de l'ancien format, pour ne pas le perdre. */
  function migrer() {
    var ancien = lireBrut(CLE_ANCIENNE);
    if (!ancien || ancien.id === undefined) return null;
    var modele = global.Bornes.vehicules.liste()[+ancien.id];
    if (!modele) return null;
    var parc = { vehicules: [{
      id: 'v1',
      nom: modele.libelle,
      modele: +ancien.id,
      conso: parseFloat(ancien.conso) || modele.conso,
      reserve: parseInt(ancien.reserve, 10) || 10
    }], actif: 'v1' };
    ecrire(parc);
    try { localStorage.removeItem(CLE_ANCIENNE); } catch (e) {}
    return parc;
  }

  function lire() {
    var parc = lireBrut(CLE);
    if (!parc || !Array.isArray(parc.vehicules)) parc = migrer() || vide();
    if (parc.actif && !parc.vehicules.some(function (v) { return v.id === parc.actif; })) {
      parc.actif = parc.vehicules.length ? parc.vehicules[0].id : null;
    }
    return parc;
  }

  function identifiant() {
    return 'v' + Date.now().toString(36) + Math.floor(Math.random() * 1000).toString(36);
  }

  function ajouter(fiche) {
    var parc = lire();
    var vehicule = {
      id: identifiant(),
      nom: (fiche.nom || '').trim(),
      modele: fiche.modele,
      conso: fiche.conso,
      reserve: fiche.reserve != null ? fiche.reserve : 10,
      puissanceMin: fiche.puissanceMin != null ? fiche.puissanceMin : 50
    };
    if (!vehicule.nom) {
      var m = global.Bornes.vehicules.liste()[fiche.modele];
      vehicule.nom = m ? m.libelle : 'Mon véhicule';
    }
    parc.vehicules.push(vehicule);
    parc.actif = vehicule.id;
    ecrire(parc);
    return vehicule;
  }

  function modifier(id, champs) {
    var parc = lire();
    parc.vehicules.forEach(function (v) {
      if (v.id === id) {
        for (var cle in champs) if (champs.hasOwnProperty(cle)) v[cle] = champs[cle];
      }
    });
    return ecrire(parc);
  }

  function supprimer(id) {
    var parc = lire();
    parc.vehicules = parc.vehicules.filter(function (v) { return v.id !== id; });
    if (parc.actif === id) parc.actif = parc.vehicules.length ? parc.vehicules[0].id : null;
    return ecrire(parc);
  }

  function activer(id) {
    var parc = lire();
    if (parc.vehicules.some(function (v) { return v.id === id; })) parc.actif = id;
    return ecrire(parc);
  }

  /* Le vehicule actif, complete par les caracteristiques de son modele. */
  function actif() {
    var parc = lire();
    if (!parc.actif) return null;
    var enregistre = null;
    parc.vehicules.forEach(function (v) { if (v.id === parc.actif) enregistre = v; });
    if (!enregistre) return null;
    var modele = global.Bornes.vehicules.liste()[enregistre.modele];
    if (!modele) return null;
    return {
      id: enregistre.id,
      nom: enregistre.nom,
      libelle: modele.libelle,
      marque: modele.marque,
      batterie: modele.batterie,
      conso: enregistre.conso || modele.conso,
      consoDefaut: modele.conso,
      charge: modele.charge,
      reserve: enregistre.reserve != null ? enregistre.reserve : 10,
      puissanceMin: enregistre.puissanceMin != null ? enregistre.puissanceMin : 50
    };
  }

  /* Marques, avec leurs modeles — pour un choix en deux temps. */
  function marques() {
    var parMarque = {};
    global.Bornes.vehicules.liste().forEach(function (v) {
      if (!parMarque[v.marque]) parMarque[v.marque] = [];
      parMarque[v.marque].push(v);
    });
    return Object.keys(parMarque).sort(function (a, b) {
      return a.localeCompare(b, 'fr');
    }).map(function (nom) {
      return { nom: nom, modeles: parMarque[nom] };
    });
  }

  global.Bornes.parc = {
    lire: lire, ajouter: ajouter, modifier: modifier, supprimer: supprimer,
    activer: activer, actif: actif, marques: marques
  };
})(window);
