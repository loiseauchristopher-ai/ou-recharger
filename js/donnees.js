/* Modele de donnees des stations de recharge.
 *
 * L'instantane est livre en colonnes paralleles (voir tools/construire_snapshot.py).
 * On les recopie dans des TypedArrays : le filtrage balaye 57 000 stations a chaque
 * frappe clavier, il faut que ce soit gratuit.
 */
(function (global) {
  'use strict';

  var PRISE = { EF: 1, T2: 2, CCS: 4, CHADEMO: 8, AUTRE: 16 };
  var DRAPEAU = {
    GRATUIT: 1, CB: 2, H24: 4, PMR: 8, RESERVATION: 16, DEUX_ROUES: 32,
    ACCES_LIBRE: 64, PAIEMENT_ACTE: 128
  };

  /* Paliers de puissance : les bornes usuelles du marche francais. */
  var PALIERS = [
    { cle: 'lent', min: 0, max: 7.4, libelle: 'Lente', detail: '≤ 7,4 kW', couleur: '#6b8cae' },
    { cle: 'accelere', min: 7.4, max: 22, libelle: 'Accélérée', detail: '7,4 – 22 kW', couleur: '#3fa796' },
    { cle: 'rapide', min: 22, max: 150, libelle: 'Rapide', detail: '22 – 150 kW', couleur: '#e8a33d' },
    { cle: 'ultra', min: 150, max: 1e9, libelle: 'Ultra-rapide', detail: '> 150 kW', couleur: '#e2584d' }
  ];

  function palier(kw) {
    for (var i = PALIERS.length - 1; i >= 0; i--) {
      if (kw > PALIERS[i].min) return PALIERS[i];
    }
    return PALIERS[0];
  }

  function sansAccent(s) {
    /* Les diacritiques sont vises par point de code plutot qu'en toutes lettres :
     * ecrite litteralement, la classe devient invalide des que le fichier est
     * relu dans un autre encodage que l'UTF-8. */
    return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  /* ------------------------------------------------------------------ Jeu */

  function Jeu(paquet) {
    var c = paquet.colonnes;
    var n = c.lat.length;
    this.taille = n;
    this.lat = Int32Array.from(c.lat);        // degres * 1e5
    this.lon = Int32Array.from(c.lon);
    this.puissance = Uint16Array.from(c.p);   // kW * 10
    this.points = Uint16Array.from(c.n);      // nombre de points de charge
    this.reseau = Uint16Array.from(c.r);
    this.prises = Uint8Array.from(c.c);
    this.drapeaux = Uint8Array.from(c.f);
    this.implantation = Uint8Array.from(c.i);
    this.horaireIdx = Uint16Array.from(c.h);
    this.villeIdx = Uint16Array.from(c.ville);
    this.cpIdx = Uint16Array.from(c.cp);
    this.majIdx = Uint16Array.from(c.maj);
    this.nom = c.nom;
    this.adresse = c.adr;

    this.reseaux = paquet.reseaux;
    this.horaires = paquet.horaires;
    this.villes = paquet.villes;
    this.cps = paquet.cps;
    this.majs = paquet.majs;
    this.implantations = paquet.implantations;
    this.source = paquet.source;
    this.nbPoints = paquet.nb_points;

    /* Index de recherche texte : commune + code postal, sans accents. */
    this.villesNorm = paquet.villes.map(sansAccent);

    /* Classement des reseaux par nombre de stations, pour la liste de filtres. */
    var compte = new Uint32Array(paquet.reseaux.length);
    var pdc = new Uint32Array(paquet.reseaux.length);
    for (var i = 0; i < n; i++) { compte[this.reseau[i]]++; pdc[this.reseau[i]] += this.points[i]; }
    this.reseauxClasses = paquet.reseaux
      .map(function (nom, idx) {
        return { idx: idx, nom: nom, stations: compte[idx], points: pdc[idx] };
      })
      .sort(function (a, b) { return b.stations - a.stations || a.nom.localeCompare(b.nom); });
  }

  Jeu.prototype.latitude = function (i) { return this.lat[i] / 1e5; };
  Jeu.prototype.longitude = function (i) { return this.lon[i] / 1e5; };
  Jeu.prototype.kw = function (i) { return this.puissance[i] / 10; };
  Jeu.prototype.a = function (i, drapeau) { return (this.drapeaux[i] & drapeau) !== 0; };
  Jeu.prototype.prise = function (i, bit) { return (this.prises[i] & bit) !== 0; };
  Jeu.prototype.ville = function (i) { return this.villes[this.villeIdx[i]]; };
  Jeu.prototype.cp = function (i) { return this.cps[this.cpIdx[i]]; };
  Jeu.prototype.horaire = function (i) { return this.horaires[this.horaireIdx[i]]; };
  Jeu.prototype.maj = function (i) { return this.majs[this.majIdx[i]]; };
  Jeu.prototype.libelle = function (i) {
    return this.nom[i] || this.adresse[i] || this.reseaux[this.reseau[i]];
  };
  /* Adresse brute et champs consolides se contredisent parfois (« 575 Rue de
   * l'Hers 31750 Escalquens » avec un code postal consolide de Bergerac). Quand
   * l'adresse porte deja un code postal, elle fait foi : on n'y ajoute rien. */
  Jeu.prototype.adresseComplete = function (i) {
    var adresse = this.adresse[i] || '';
    if (/\b\d{5}\b/.test(adresse)) return adresse;
    var localite = (this.cp(i) + ' ' + this.ville(i)).trim();
    return [adresse, localite].filter(Boolean).join(', ');
  };

  /* Distance orthodromique en km (formule de Haversine). */
  function distanceKm(lat1, lon1, lat2, lon2) {
    var R = 6371, rad = Math.PI / 180;
    var dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  global.Bornes = global.Bornes || {};
  global.Bornes.PRISE = PRISE;
  global.Bornes.DRAPEAU = DRAPEAU;
  global.Bornes.PALIERS = PALIERS;
  global.Bornes.palier = palier;
  global.Bornes.Jeu = Jeu;
  global.Bornes.distanceKm = distanceKm;
  global.Bornes.sansAccent = sansAccent;
})(window);
