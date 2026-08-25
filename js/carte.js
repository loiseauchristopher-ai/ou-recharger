/* Carte canvas autonome : projection Web Mercator, deplacement, zoom, clusters.
 *
 * Pas de bibliotheque ni de tuiles distantes — l'app doit rester utilisable hors
 * ligne et dans un contexte ou les requetes sortantes sont bloquees. Le fond est
 * un simple trace des departements, suffisant comme repere.
 */
(function (global) {
  'use strict';

  var TAILLE_TUILE = 256;

  function lonEnX(lon) { return (lon + 180) / 360; }
  function latEnY(lat) {
    var s = Math.sin(lat * Math.PI / 180);
    s = Math.max(-0.9999, Math.min(0.9999, s));
    return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  }
  function xEnLon(x) { return x * 360 - 180; }
  function yEnLat(y) {
    var n = Math.PI * (1 - 2 * y);
    return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  }

  function Carte(canvas, options) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.opts = options || {};
    this.centre = { lat: 46.7, lon: 2.5 };
    this.zoom = 5.2;
    this.pitch = 0;                // inclinaison de la vue, en radians
    this.zoomMin = 4;
    this.zoomMax = 18;
    this.contours = [];
    this.fond = global.Bornes.tuiles ? global.Bornes.tuiles.fondParCle('plan') : null;
    this.cacheTuiles = global.Bornes.tuiles ? new global.Bornes.tuiles.Cache() : null;
    this.cibles = [];              // objets dessines, pour le test de clic
    this.marqueur = null;          // { lat, lon, rayonKm }
    this.route = null;             // { points: [[lon, lat]...], etapes: [{lat, lon, rang}] }
    this.jeu = null;
    this.indices = null;
    this.couleurDe = null;
    this.selection = -1;
    this.survol = -1;
    this._brancherEvenements();
  }

  /* Change le fond de carte. Renvoie le fond effectivement retenu. */
  Carte.prototype.definirFond = function (cle) {
    if (!global.Bornes.tuiles) return null;
    this.fond = global.Bornes.tuiles.fondParCle(cle);
    this.dessiner();
    if (this.opts.surChangementFond) this.opts.surChangementFond(this.fond);
    return this.fond;
  };

  Carte.prototype.definirContours = function (traces) {
    this.contours = traces || [];
    this.dessiner();
  };

  /* Trace d'itineraire et arrets de recharge, dessines sous les stations. */
  Carte.prototype.definirRoute = function (route) {
    this.route = route;
    this.dessiner();
  };

  /* Cadre la vue sur l'ensemble d'un trace. */
  Carte.prototype.cadrerSur = function (points) {
    if (!points || !points.length) return;
    var latMin = 90, latMax = -90, lonMin = 180, lonMax = -180;
    for (var i = 0; i < points.length; i++) {
      var lon = points[i][0], lat = points[i][1];
      if (lat < latMin) latMin = lat;
      if (lat > latMax) latMax = lat;
      if (lon < lonMin) lonMin = lon;
      if (lon > lonMax) lonMax = lon;
    }
    var largeurDeg = Math.max(lonMax - lonMin, 0.01);
    var hauteurDeg = Math.max(latEnY(latMin) - latEnY(latMax), 0.0001) * 360;
    var zoomLon = Math.log2(this.largeur / (TAILLE_TUILE * (largeurDeg / 360)));
    var zoomLat = Math.log2(this.hauteur / (TAILLE_TUILE * (hauteurDeg / 360)));
    var zoom = Math.min(zoomLon, zoomLat) - 0.35;          // un peu de marge
    this.centrerSur((latMin + latMax) / 2, (lonMin + lonMax) / 2,
      Math.max(this.zoomMin, Math.min(this.zoomMax, zoom)));
  };

  Carte.prototype.definirDonnees = function (jeu, indices, couleurDe) {
    this.jeu = jeu;
    this.indices = indices;
    if (couleurDe) this.couleurDe = couleurDe;
    this.dessiner();
  };

  /* ------------------------------------------------------- Projection ecran */

  Carte.prototype.echelle = function () {
    return TAILLE_TUILE * Math.pow(2, this.zoom);
  };

  /* Vue inclinee.
   *
   * On part de la vue a plat, puis on bascule le plan de la carte autour de son
   * axe horizontal median. Un point situe au-dessus du centre s'eloigne (il
   * retrecit et remonte vers l'horizon), un point en dessous se rapproche.
   *
   *   z = d - dy·sin θ      profondeur du point
   *   facteur = d / z       retrecissement du a la distance
   *
   * `d` est la distance focale : plus elle est grande, plus la perspective est
   * douce. La transformation est analytiquement inversible, ce qui permet de
   * garder un clic precis et un deplacement coherent. */
  Carte.prototype.focale = function () {
    /* Plus la focale est courte, plus la perspective est marquée — au prix
     * d'une déformation. Autour d'une fois la hauteur, la profondeur se voit
     * sans que les tuiles proches paraissent étirées. */
    return this.hauteur * 1.0;
  };

  Carte.prototype._perspective = function (x, y) {
    if (!this.pitch) return { x: x, y: y, facteur: 1 };
    var cx = this.largeur / 2, cy = this.hauteur / 2;
    var d = this.focale();
    var dy = y - cy;
    var z = d - dy * Math.sin(this.pitch);
    if (z < 1) z = 1;                       // au-dela de l'horizon
    var facteur = d / z;
    return {
      x: cx + (x - cx) * facteur,
      y: cy + dy * Math.cos(this.pitch) * facteur,
      facteur: facteur
    };
  };

  Carte.prototype._inversePerspective = function (xe, ye) {
    if (!this.pitch) return { x: xe, y: ye };
    var cx = this.largeur / 2, cy = this.hauteur / 2;
    var d = this.focale();
    var Y = ye - cy;
    var denominateur = d * Math.cos(this.pitch) + Y * Math.sin(this.pitch);
    if (Math.abs(denominateur) < 1e-6) return { x: xe, y: -1e6 };
    var dy = Y * d / denominateur;
    var facteur = d / Math.max(1, d - dy * Math.sin(this.pitch));
    return { x: cx + (xe - cx) / facteur, y: cy + dy };
  };

  /* Ordonnee de l'horizon : au-dela, le plan de la carte passe derriere la
   * camera et il n'y a plus rien a dessiner. */
  Carte.prototype.horizon = function () {
    if (!this.pitch) return -Infinity;
    var d = this.focale();
    var cy = this.hauteur / 2;
    return cy - (d * Math.cos(this.pitch)) / Math.sin(this.pitch) + 1;
  };

  /* Coordonnees « a plat », avant inclinaison. */
  Carte.prototype._versPlat = function (lat, lon) {
    var e = this.echelle();
    var cx = lonEnX(this.centre.lon) * e, cy = latEnY(this.centre.lat) * e;
    return {
      x: lonEnX(lon) * e - cx + this.largeur / 2,
      y: latEnY(lat) * e - cy + this.hauteur / 2
    };
  };

  Carte.prototype.versEcran = function (lat, lon) {
    var plat = this._versPlat(lat, lon);
    return this._perspective(plat.x, plat.y);
  };

  Carte.prototype.versGeo = function (px, py) {
    var plat = this._inversePerspective(px, py);
    var e = this.echelle();
    var cx = lonEnX(this.centre.lon) * e, cy = latEnY(this.centre.lat) * e;
    return {
      lon: xEnLon((plat.x - this.largeur / 2 + cx) / e),
      lat: yEnLat((plat.y - this.hauteur / 2 + cy) / e)
    };
  };

  /* Inclinaison, bornee : au-dela de 60° la carte se reduit a une bande floue
   * pres de l'horizon, sans rien apporter. */
  Carte.prototype.definirPitch = function (degres) {
    var borne = Math.max(0, Math.min(60, degres));
    this.pitch = borne * Math.PI / 180;
    this.dessiner();
    if (this.opts.surChangementPitch) this.opts.surChangementPitch(borne);
    return borne;
  };

  Carte.prototype.pitchDegres = function () {
    return Math.round(this.pitch * 180 / Math.PI);
  };

  /* Zone geographique visible : [lonMin, latMin, lonMax, latMax] */
  Carte.prototype.emprise = function () {
    var a = this.versGeo(0, 0), b = this.versGeo(this.largeur, this.hauteur);
    return [a.lon, b.lat, b.lon, a.lat];
  };

  Carte.prototype.centrerSur = function (lat, lon, zoom) {
    this.centre = { lat: lat, lon: lon };
    if (zoom != null) this.zoom = Math.max(this.zoomMin, Math.min(this.zoomMax, zoom));
    this.dessiner();
    if (this.opts.surDeplacement) this.opts.surDeplacement();
  };

  /* Cadre la carte sur un rayon donne autour d'un point. */
  Carte.prototype.cadrerRayon = function (lat, lon, rayonKm) {
    var largeurKm = rayonKm * 2.4;
    var degres = largeurKm / (111.32 * Math.cos(lat * Math.PI / 180));
    var fraction = degres / 360;
    var zoom = Math.log2(this.largeur / (TAILLE_TUILE * fraction));
    this.centrerSur(lat, lon, Math.max(this.zoomMin, Math.min(this.zoomMax, zoom)));
  };

  /* ------------------------------------------------------------ Evenements */

  Carte.prototype._brancherEvenements = function () {
    var self = this, drag = null, bouge = false;

    function pos(ev) {
      var r = self.canvas.getBoundingClientRect();
      var src = ev.touches && ev.touches.length ? ev.touches[0] : ev;
      return { x: src.clientX - r.left, y: src.clientY - r.top };
    }

    this.canvas.addEventListener('pointerdown', function (ev) {
      self.canvas.setPointerCapture(ev.pointerId);
      drag = pos(ev); bouge = false;
      self.canvas.classList.add('saisi');
    });

    this.canvas.addEventListener('pointermove', function (ev) {
      var p = pos(ev);
      if (drag) {
        if (Math.abs(p.x - drag.x) + Math.abs(p.y - drag.y) > 3) bouge = true;
        /* En vue inclinée, un pixel d'écran ne vaut pas la même distance en
         * haut et en bas : on repasse à plat avant de déplacer le centre. */
        var avant = self._inversePerspective(drag.x, drag.y);
        var apres = self._inversePerspective(p.x, p.y);
        var dx = apres.x - avant.x, dy = apres.y - avant.y;
        var e = self.echelle();
        self.centre = {
          lat: yEnLat(latEnY(self.centre.lat) - dy / e),
          lon: xEnLon(lonEnX(self.centre.lon) - dx / e)
        };
        drag = p;
        self.dessiner();
        if (self.opts.surDeplacement) self.opts.surDeplacement();
      } else {
        var cible = self.cibleA(p.x, p.y);
        var idx = cible && cible.station != null ? cible.station : -1;
        if (idx !== self.survol) {
          self.survol = idx;
          self.canvas.style.cursor = cible ? 'pointer' : 'grab';
          self.dessiner();
        }
      }
    });

    function relacher(ev) {
      self.canvas.classList.remove('saisi');
      if (drag && !bouge) {
        var p = pos(ev);
        var cible = self.cibleA(p.x, p.y);
        if (cible && cible.station != null && self.opts.surClicStation) {
          self.opts.surClicStation(cible.station);
        } else if (cible && cible.groupe && self.opts.surClicGroupe) {
          self.opts.surClicGroupe(cible);
        }
      }
      drag = null;
    }
    this.canvas.addEventListener('pointerup', relacher);
    this.canvas.addEventListener('pointercancel', function () { drag = null; });

    this.canvas.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      var p = pos(ev);
      var avant = self.versGeo(p.x, p.y);
      var pas = -ev.deltaY * (ev.deltaMode === 1 ? 0.05 : 0.0025);
      self.zoom = Math.max(self.zoomMin, Math.min(self.zoomMax, self.zoom + pas));
      var apres = self.versGeo(p.x, p.y);
      self.centre = {
        lat: yEnLat(latEnY(self.centre.lat) + latEnY(avant.lat) - latEnY(apres.lat)),
        lon: self.centre.lon + avant.lon - apres.lon
      };
      self.dessiner();
      if (self.opts.surDeplacement) self.opts.surDeplacement();
    }, { passive: false });

    this.canvas.addEventListener('dblclick', function (ev) {
      var p = pos(ev);
      var g = self.versGeo(p.x, p.y);
      self.centrerSur(g.lat, g.lon, self.zoom + 1.5);
    });
  };

  Carte.prototype.zoomer = function (delta) {
    this.zoom = Math.max(this.zoomMin, Math.min(this.zoomMax, this.zoom + delta));
    this.dessiner();
    if (this.opts.surDeplacement) this.opts.surDeplacement();
  };

  Carte.prototype.cibleA = function (x, y) {
    for (var i = this.cibles.length - 1; i >= 0; i--) {
      var c = this.cibles[i];
      var d = (x - c.x) * (x - c.x) + (y - c.y) * (y - c.y);
      if (d <= (c.r + 4) * (c.r + 4)) return c;
    }
    return null;
  };

  /* ---------------------------------------------------------------- Rendu */

  Carte.prototype.redimensionner = function () {
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    var r = this.canvas.getBoundingClientRect();
    this.largeur = r.width;
    this.hauteur = r.height;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.dessiner();
  };

  Carte.prototype.dessiner = function () {
    if (!this.largeur) return;
    var self = this;
    if (this._enAttente) return;
    this._enAttente = true;
    global.requestAnimationFrame(function () {
      self._enAttente = false;
      self._rendre();
    });
  };

  Carte.prototype._style = function (nom, defaut) {
    var v = getComputedStyle(this.canvas).getPropertyValue(nom);
    return (v && v.trim()) || defaut;
  };

  Carte.prototype._rendre = function () {
    var ctx = this.ctx, L = this.largeur, H = this.hauteur;
    ctx.clearRect(0, 0, L, H);
    ctx.fillStyle = this._style('--carte-fond', '#eef2f6');
    ctx.fillRect(0, 0, L, H);

    this._rendreCiel(ctx);
    var tuilesDessinees = this._rendreTuiles(ctx);
    /* Le tracé des départements sert de fond de repli : inutile de le
     * superposer aux tuiles, qui portent déjà les frontières. */
    if (!tuilesDessinees) this._rendreContours(ctx);
    this._rendreRayon(ctx);
    this._rendreRoute(ctx);
    this.cibles = [];
    this._rendreStations(ctx);
    this._rendreArrets(ctx);
    this._rendreMarqueur(ctx);
  };

  /* Dessine les tuiles du fond courant. Renvoie true si au moins une tuile a
   * ete peinte — sinon l'appelant retombe sur le trace des departements. */
  Carte.prototype._rendreTuiles = function (ctx) {
    var fond = this.fond;
    if (!fond || !fond.url || !this.cacheTuiles) return false;
    if (this.cacheTuiles.injoignable()) return false;

    var z = Math.max(0, Math.min(fond.zoomMax, Math.round(this.zoom)));
    var facteur = Math.pow(2, this.zoom - z);
    var taille = TAILLE_TUILE * facteur;
    var monde = Math.pow(2, z);

    /* Coin haut-gauche de la vue, en coordonnees de tuile. */
    var e = this.echelle();
    var cx = lonEnX(this.centre.lon) * e, cy = latEnY(this.centre.lat) * e;
    var gaucheMonde = (cx - this.largeur / 2) / e;
    var hautMonde = (cy - this.hauteur / 2) / e;

    /* Inclinee, la vue porte bien plus loin que le rectangle de l'ecran : on
     * borne la zone a couvrir par les quatre coins ramenes a plat. */
    var plat = this._empriseAPlat();
    var x0 = Math.floor((gaucheMonde + plat.gauche / e) * monde);
    var y0 = Math.floor((hautMonde + plat.haut / e) * monde);
    var x1 = Math.floor((gaucheMonde + plat.droite / e) * monde);
    var y1 = Math.floor((hautMonde + plat.bas / e) * monde);

    /* Garde-fou : une inclinaison forte peut demander des milliers de tuiles. */
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 900) {
      var trop = new Error('zone trop vaste');
      trop.benin = true;
      x0 = Math.max(x0, Math.floor(gaucheMonde * monde) - 2);
      y0 = Math.max(y0, Math.floor(hautMonde * monde) - 2);
    }

    var self = this;
    var redessiner = function () { self.dessiner(); };
    var retine = (global.devicePixelRatio || 1) > 1.3;
    var peintes = 0;

    for (var y = y0; y <= y1; y++) {
      if (y < 0 || y >= monde) continue;
      for (var x = x0; x <= x1; x++) {
        var tx = ((x % monde) + monde) % monde;          // la carte fait le tour
        var img = this.cacheTuiles.obtenir(fond, z, tx, y, retine, redessiner);
        if (!img) continue;
        var px = (x / monde - gaucheMonde) * e;
        var py = (y / monde - hautMonde) * e;
        if (this.pitch) {
          if (this._tuileInclinee(ctx, img, px, py, taille)) peintes++;
        } else {
          /* Un demi-pixel de recouvrement : sans lui, l'arrondi laisse des
           * coutures claires entre les tuiles. */
          ctx.drawImage(img, px, py, taille + 0.5, taille + 0.5);
          peintes++;
        }
      }
    }
    return peintes > 0;
  };

  /* Au-dessus de l'horizon il n'y a plus de carte : un degrade evite d'y
   * laisser la couleur de fond, qui ferait comme un bandeau vide. */
  Carte.prototype._rendreCiel = function (ctx) {
    if (!this.pitch) return;
    var horizon = Math.min(this.hauteur, Math.max(0, this.horizon()));
    if (horizon <= 0) return;
    var degrade = ctx.createLinearGradient(0, 0, 0, horizon);
    degrade.addColorStop(0, this._style('--carte-ciel-haut', '#9dc0e4'));
    degrade.addColorStop(1, this._style('--carte-ciel-bas', '#dfe7ef'));
    ctx.fillStyle = degrade;
    ctx.fillRect(0, 0, this.largeur, horizon);
  };

  /* Emprise visible ramenee dans le repere « a plat », en pixels relatifs au
   * coin haut-gauche de l'ecran. */
  Carte.prototype._empriseAPlat = function () {
    if (!this.pitch) {
      return { gauche: 0, haut: 0, droite: this.largeur, bas: this.hauteur };
    }
    var limite = Math.max(0, this.horizon() + 2);
    var coins = [
      this._inversePerspective(0, limite),
      this._inversePerspective(this.largeur, limite),
      this._inversePerspective(0, this.hauteur),
      this._inversePerspective(this.largeur, this.hauteur)
    ];
    var gauche = Infinity, droite = -Infinity, haut = Infinity, bas = -Infinity;
    for (var i = 0; i < coins.length; i++) {
      gauche = Math.min(gauche, coins[i].x); droite = Math.max(droite, coins[i].x);
      haut = Math.min(haut, coins[i].y); bas = Math.max(bas, coins[i].y);
    }
    /* Une vue tres inclinee « voit » jusqu'a l'infini : on borne a dix ecrans. */
    var plafond = this.hauteur * 10;
    return {
      gauche: Math.max(gauche, -plafond), droite: Math.min(droite, this.largeur + plafond),
      haut: Math.max(haut, -plafond), bas: Math.min(bas, this.hauteur + plafond)
    };
  };

  /* Dessine une tuile sur le plan incline. Une transformation affine ne sait
   * pas produire un trapeze : on decoupe la tuile en bandes horizontales,
   * chacune assez fine pour etre traitee comme un parallelogramme. */
  Carte.prototype._tuileInclinee = function (ctx, img, px, py, taille) {
    var BANDES = 8;
    var source = img.naturalWidth || TAILLE_TUILE;
    var horizon = this.horizon();
    var peinte = false;

    for (var b = 0; b < BANDES; b++) {
      var v0 = b / BANDES, v1 = (b + 1) / BANDES;
      var yHaut = py + v0 * taille;
      var yBas = py + v1 * taille;
      if (yBas <= horizon) continue;                 // bande passee derriere l'horizon

      var hg = this._perspective(px, yHaut);
      var hd = this._perspective(px + taille, yHaut);
      var bg = this._perspective(px, yBas);
      if (!isFinite(hg.x) || !isFinite(bg.y)) continue;
      if (Math.max(hg.y, bg.y) < -this.hauteur || Math.min(hg.y, bg.y) > this.hauteur * 2) continue;

      var hauteurSource = source / BANDES;
      var ax = (hd.x - hg.x) / source;
      var ay = (hd.y - hg.y) / source;
      var bx = (bg.x - hg.x) / hauteurSource;
      var by = (bg.y - hg.y) / hauteurSource;

      ctx.save();
      ctx.transform(ax, ay, bx, by, hg.x - bx * (v0 * source), hg.y - by * (v0 * source));
      /* Un peu de recouvrement vertical pour masquer les coutures entre bandes. */
      ctx.drawImage(img, 0, v0 * source, source, hauteurSource + 1,
                    0, v0 * source, source, hauteurSource + 1);
      ctx.restore();
      peinte = true;
    }
    return peinte;
  };

  Carte.prototype._rendreContours = function (ctx) {
    if (!this.contours.length) return;
    var e = this.echelle();
    var cx = lonEnX(this.centre.lon) * e, cy = latEnY(this.centre.lat) * e;
    var dx = this.largeur / 2 - cx, dy = this.hauteur / 2 - cy;
    ctx.beginPath();
    for (var t = 0; t < this.contours.length; t++) {
      var trace = this.contours[t];
      for (var i = 0; i < trace.length; i++) {
        var p = this._perspective(lonEnX(trace[i][0]) * e + dx, latEnY(trace[i][1]) * e + dy);
        if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
    }
    ctx.fillStyle = this._style('--carte-terre', '#ffffff');
    ctx.fill();
    ctx.strokeStyle = this._style('--carte-trait', '#c9d4e0');
    ctx.lineWidth = 1;
    ctx.stroke();
  };

  Carte.prototype._rendreRayon = function (ctx) {
    var m = this.marqueur;
    if (!m || !m.rayonKm) return;
    var c = this.versEcran(m.lat, m.lon);
    var bord = this.versEcran(m.lat, m.lon + m.rayonKm / (111.32 * Math.cos(m.lat * Math.PI / 180)));
    var r = Math.abs(bord.x - c.x);
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fillStyle = this._style('--carte-rayon-fond', 'rgba(45,110,200,0.07)');
    ctx.fill();
    ctx.setLineDash([6, 5]);
    ctx.strokeStyle = this._style('--carte-rayon-trait', 'rgba(45,110,200,0.5)');
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
  };

  /* Regroupe les stations par cellule d'ecran pour rester lisible et rapide.
   * La cellule doit rester plus large que la plus grosse bulle, sinon les groupes
   * se recouvrent et finissent par masquer le fond de carte. */
  Carte.prototype._rendreStations = function (ctx) {
    if (!this.jeu || !this.indices) return;
    var jeu = this.jeu, idx = this.indices;
    var cellule = 50;
    var colonnes = Math.ceil(this.largeur / cellule) + 2;
    var groupes = new Map();
    var e = this.echelle();
    var cx = lonEnX(this.centre.lon) * e, cy = latEnY(this.centre.lat) * e;
    var dx = this.largeur / 2 - cx, dy = this.hauteur / 2 - cy;
    var marge = 40;

    for (var k = 0; k < idx.length; k++) {
      var s = idx[k];
      var brut = this._perspective(lonEnX(jeu.lon[s] / 1e5) * e + dx,
                                   latEnY(jeu.lat[s] / 1e5) * e + dy);
      var x = brut.x, y = brut.y;
      if (x < -marge || x > this.largeur + marge) continue;
      if (y < -marge || y > this.hauteur + marge) continue;

      var ci = Math.floor(x / cellule), cj = Math.floor(y / cellule);
      var cle = ci + colonnes * cj;
      var g = groupes.get(cle);
      if (!g) {
        groupes.set(cle, {
          x: x, y: y, n: 1, station: s, pmax: jeu.puissance[s], sx: x, sy: y,
          cx: (ci + 0.5) * cellule, cy: (cj + 0.5) * cellule,
          paliers: [0, 0, 0, 0]
        });
        g = groupes.get(cle);
      } else {
        g.n++; g.sx += x; g.sy += y;
        if (jeu.puissance[s] > g.pmax) { g.pmax = jeu.puissance[s]; g.station = s; }
      }
      g.paliers[palierIndex(jeu.puissance[s] / 10)]++;
    }

    var self = this;
    var police = this._style('--carte-police', 'system-ui, sans-serif');
    groupes.forEach(function (g) {
      if (g.n === 1) {
        self._rendrePoint(ctx, g);
      } else {
        /* Barycentre legerement rappele vers le centre de cellule : assez pour
         * que deux bulles voisines ne se touchent pas, pas assez pour que la
         * carte prenne un air de damier. */
        var poids = 0.3;
        g.x = (g.sx / g.n) * (1 - poids) + g.cx * poids;
        g.y = (g.sy / g.n) * (1 - poids) + g.cy * poids;
        self._rendreGroupe(ctx, g, police);
      }
    });

    /* La station selectionnee passe toujours au premier plan. */
    if (this.selection >= 0) {
      var p = this.versEcran(jeu.latitude(this.selection), jeu.longitude(this.selection));
      this._rendrePoint(ctx, { x: p.x, y: p.y, n: 1, station: this.selection }, true);
    }
  };

  Carte.prototype._rendrePoint = function (ctx, g, force) {
    var s = g.station;
    var couleur = this.couleurDe ? this.couleurDe(s) : '#2d6ec8';
    var actif = force || s === this.selection;
    var r = actif ? 10 : (s === this.survol ? 8 : 6);
    ctx.beginPath();
    ctx.arc(g.x, g.y, r, 0, Math.PI * 2);
    ctx.fillStyle = couleur;
    ctx.fill();
    ctx.lineWidth = actif ? 3 : 1.5;
    ctx.strokeStyle = actif ? this._style('--carte-selection', '#12233a') : '#ffffff';
    ctx.stroke();
    this.cibles.push({ x: g.x, y: g.y, r: r, station: s });
  };

  Carte.prototype._rendreGroupe = function (ctx, g, police) {
    var r = g.n < 10 ? 11 : (g.n < 100 ? 13 : (g.n < 1000 ? 16 : 18));
    /* Couleur du palier dominant : prendre celle de la station la plus puissante
     * peindrait toute la France en rouge des qu'un site ultra-rapide existe. */
    var couleur = this._couleurDominante(g);
    ctx.beginPath();
    ctx.arc(g.x, g.y, r + 3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(g.x, g.y, r, 0, Math.PI * 2);
    ctx.fillStyle = couleur;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = '600 ' + (g.n < 100 ? 11 : 10) + 'px ' + police;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(g.n < 1000 ? String(g.n) : Math.round(g.n / 100) / 10 + 'k', g.x, g.y);
    this.cibles.push({ x: g.x, y: g.y, r: r, groupe: g });
  };

  /* Index de palier (0 lent -> 3 ultra), aligne sur Bornes.PALIERS. */
  function palierIndex(kw) {
    if (kw > 150) return 3;
    if (kw > 22) return 2;
    if (kw > 7.4) return 1;
    return 0;
  }

  Carte.prototype._couleurDominante = function (g) {
    var paliers = global.Bornes.PALIERS;
    var meilleur = 0;
    for (var i = 1; i < 4; i++) if (g.paliers[i] > g.paliers[meilleur]) meilleur = i;
    return paliers[meilleur].couleur;
  };

  Carte.prototype._rendreRoute = function (ctx) {
    if (!this.route || !this.route.points || this.route.points.length < 2) return;
    var e = this.echelle();
    var cx = lonEnX(this.centre.lon) * e, cy = latEnY(this.centre.lat) * e;
    var dx = this.largeur / 2 - cx, dy = this.hauteur / 2 - cy;
    var points = this.route.points;

    ctx.beginPath();
    for (var i = 0; i < points.length; i++) {
      var p = this._perspective(lonEnX(points[i][0]) * e + dx, latEnY(points[i][1]) * e + dy);
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    /* Double trait : un liseré clair dessous pour rester lisible sur la carte. */
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 8;
    ctx.stroke();
    ctx.strokeStyle = this._style('--carte-route', '#1f5fbf');
    ctx.lineWidth = 4;
    ctx.stroke();
  };

  Carte.prototype._rendreArrets = function (ctx) {
    if (!this.route || !this.route.etapes) return;
    var police = this._style('--carte-police', 'system-ui, sans-serif');
    for (var i = 0; i < this.route.etapes.length; i++) {
      var etape = this.route.etapes[i];
      var p = this.versEcran(etape.lat, etape.lon);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 13, 0, Math.PI * 2);
      ctx.fillStyle = this._style('--carte-route', '#1f5fbf');
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = '600 12px ' + police;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), p.x, p.y);
      this.cibles.push({ x: p.x, y: p.y, r: 13, station: etape.station });
    }
  };

  Carte.prototype._rendreMarqueur = function (ctx) {
    var m = this.marqueur;
    if (!m) return;
    var p = this.versEcran(m.lat, m.lon);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = this._style('--carte-marqueur', '#12233a');
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  };

  global.Bornes = global.Bornes || {};
  global.Bornes.Carte = Carte;
})(window);
