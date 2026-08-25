/* Fonds de carte en tuiles raster.
 *
 * Le trace des departements suffisait a se reperer a l'echelle du pays ; pour
 * choisir une borne on a besoin des rues, du bati, parfois de la vue aerienne.
 * Ce module va chercher les tuiles, les met en cache et les dessine — sans
 * bibliotheque, pour rester coherent avec le reste de la carte.
 *
 * Aucun fond n'exige de cle : ils sont utilisables tant qu'on affiche leur
 * attribution, ce que fait la carte en bas a droite.
 */
(function (global) {
  'use strict';

  var FONDS = [
    {
      cle: 'plan',
      libelle: 'Plan',
      url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      sousDomaines: ['a', 'b', 'c', 'd'],
      zoomMax: 20,
      attribution: '© OpenStreetMap, © CARTO'
    },
    {
      cle: 'satellite',
      libelle: 'Satellite',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      zoomMax: 19,
      attribution: '© Esri, Maxar, Earthstar Geographics'
    },
    {
      cle: 'relief',
      libelle: 'Relief',
      url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
      sousDomaines: ['a', 'b', 'c'],
      zoomMax: 17,
      attribution: '© OpenStreetMap, SRTM — © OpenTopoMap (CC-BY-SA)'
    },
    {
      cle: 'contours',
      libelle: 'Sobre',
      url: null,                       // trace local : ni requete, ni attribution
      zoomMax: 20,
      attribution: 'Contours : © IGN / data.gouv.fr'
    }
  ];

  function fondParCle(cle) {
    for (var i = 0; i < FONDS.length; i++) if (FONDS[i].cle === cle) return FONDS[i];
    return FONDS[0];
  }

  /* --------------------------------------------------------------- Cache */

  function Cache(limite) {
    this.limite = limite || 400;
    this.images = new Map();
    this.echecs = new Set();
  }

  Cache.prototype.adresse = function (fond, z, x, y, retine) {
    var s = fond.sousDomaines
      ? fond.sousDomaines[(x + y) % fond.sousDomaines.length]
      : '';
    return fond.url
      .replace('{s}', s)
      .replace('{z}', z)
      .replace('{x}', x)
      .replace('{y}', y)
      .replace('{r}', retine && fond.cle === 'plan' ? '@2x' : '');
  };

  /* Renvoie l'image si elle est prete, sinon lance le chargement et renvoie
   * null — le rendu se contentera d'un niveau de zoom deja charge. */
  Cache.prototype.obtenir = function (fond, z, x, y, retine, quandPrete) {
    var url = this.adresse(fond, z, x, y, retine);
    if (this.echecs.has(url)) return null;
    var img = this.images.get(url);
    if (img) {
      this.images.delete(url);          // remise en tete : eviction du plus ancien
      this.images.set(url, img);
      return img.complete && img.naturalWidth ? img : null;
    }

    img = new Image();
    img.crossOrigin = 'anonymous';
    var self = this;
    img.onload = function () { if (quandPrete) quandPrete(); };
    img.onerror = function () {
      self.echecs.add(url);
      self.images.delete(url);
    };
    img.src = url;
    this.images.set(url, img);

    if (this.images.size > this.limite) {
      var plusAncienne = this.images.keys().next().value;
      this.images.delete(plusAncienne);
    }
    return null;
  };

  /* Y a-t-il eu assez d'echecs pour conclure que les tuiles sont injoignables ?
   * C'est le cas hors ligne, ou dans un cadre qui bloque les requetes. */
  Cache.prototype.injoignable = function () {
    return this.echecs.size >= 6 && this.images.size === 0;
  };

  global.Bornes = global.Bornes || {};
  global.Bornes.tuiles = { FONDS: FONDS, fondParCle: fondParCle, Cache: Cache };
})(window);
