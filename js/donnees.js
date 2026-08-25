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

    this._classerReseaux();
  }

  /* Classement des reseaux par nombre de stations, pour la liste de filtres. */
  Jeu.prototype._classerReseaux = function () {
    var compte = new Uint32Array(this.reseaux.length);
    var pdc = new Uint32Array(this.reseaux.length);
    for (var i = 0; i < this.taille; i++) {
      compte[this.reseau[i]]++;
      pdc[this.reseau[i]] += this.points[i];
    }
    this.reseauxClasses = this.reseaux
      .map(function (nom, idx) {
        return { idx: idx, nom: nom, stations: compte[idx], points: pdc[idx] };
      })
      .filter(function (r) { return r.stations > 0; })
      .sort(function (a, b) { return b.stations - a.stations || a.nom.localeCompare(b.nom); });
  };

  /* Ajoute des stations venues d'ailleurs (OpenStreetMap, hors de France).
   *
   * Les colonnes sont des TypedArrays de taille fixe : on realloue. L'operation
   * est rare — elle n'a lieu que lorsque l'utilisateur demande une zone hors du
   * jeu francais — et reste bien plus simple qu'un second jeu a maintenir en
   * parallele dans le filtrage et le rendu.
   */
  function etendre(TableauType, ancien, taille) {
    var neuf = new TableauType(taille);
    neuf.set(ancien);
    return neuf;
  }

  Jeu.prototype.ajouter = function (stations) {
    if (!stations || !stations.length) return 0;
    var depart = this.taille;
    var taille = depart + stations.length;

    this.lat = etendre(Int32Array, this.lat, taille);
    this.lon = etendre(Int32Array, this.lon, taille);
    this.puissance = etendre(Uint16Array, this.puissance, taille);
    this.points = etendre(Uint16Array, this.points, taille);
    this.reseau = etendre(Uint16Array, this.reseau, taille);
    this.prises = etendre(Uint8Array, this.prises, taille);
    this.drapeaux = etendre(Uint8Array, this.drapeaux, taille);
    this.implantation = etendre(Uint8Array, this.implantation, taille);
    this.horaireIdx = etendre(Uint16Array, this.horaireIdx, taille);
    this.villeIdx = etendre(Uint16Array, this.villeIdx, taille);
    this.cpIdx = etendre(Uint16Array, this.cpIdx, taille);
    this.majIdx = etendre(Uint16Array, this.majIdx, taille);

    var self = this;
    function indexer(valeur, table, norme) {
      var v = valeur || '';
      var rang = table.indexOf(v);
      if (rang < 0) {
        rang = table.length;
        table.push(v);
        if (norme) norme.push(global.Bornes.sansAccent(v));
      }
      return rang;
    }

    for (var k = 0; k < stations.length; k++) {
      var s = stations[k];
      var i = depart + k;
      this.lat[i] = Math.round(s.lat * 1e5);
      this.lon[i] = Math.round(s.lon * 1e5);
      this.puissance[i] = Math.min(65535, Math.round((s.kw || 0) * 10));
      this.points[i] = Math.min(65535, s.points || 1);
      this.reseau[i] = indexer(s.reseau, this.reseaux);
      this.prises[i] = s.prises || 0;
      this.drapeaux[i] = s.drapeaux || 0;
      this.implantation[i] = this.implantations.length - 1;      // « Autre »
      this.horaireIdx[i] = indexer(s.horaires, this.horaires);
      this.villeIdx[i] = indexer(s.ville, this.villes, this.villesNorm);
      this.cpIdx[i] = indexer(s.cp, this.cps);
      this.majIdx[i] = indexer('', this.majs);
      this.nom.push(s.nom || '');
      this.adresse.push(s.adresse || '');
      this.externe = this.externe || {};
      this.externe[i] = s.source || 'externe';
    }

    this.taille = taille;
    this.nbPoints = 0;
    for (var j = 0; j < taille; j++) this.nbPoints += this.points[j];
    this._classerReseaux();
    return stations.length;
  };

  /* Une station venue d'OpenStreetMap n'a ni etat temps reel ni identifiant
   * d'itinerance : l'interface doit pouvoir le dire. */
  Jeu.prototype.estExterne = function (i) {
    return !!(this.externe && this.externe[i]);
  };

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
