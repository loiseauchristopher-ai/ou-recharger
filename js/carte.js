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
    this.zoomMin = 4;
    this.zoomMax = 18;
    this.contours = [];
    this.cibles = [];              // objets dessines, pour le test de clic
    this.marqueur = null;          // { lat, lon, rayonKm }
    this.jeu = null;
    this.indices = null;
    this.couleurDe = null;
    this.selection = -1;
    this.survol = -1;
    this._brancherEvenements();
  }

  Carte.prototype.definirContours = function (traces) {
    this.contours = traces || [];
    this.dessiner();
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

  Carte.prototype.versEcran = function (lat, lon) {
    var e = this.echelle();
    var cx = lonEnX(this.centre.lon) * e, cy = latEnY(this.centre.lat) * e;
    return {
      x: lonEnX(lon) * e - cx + this.largeur / 2,
      y: latEnY(lat) * e - cy + this.hauteur / 2
    };
  };

  Carte.prototype.versGeo = function (px, py) {
    var e = this.echelle();
    var cx = lonEnX(this.centre.lon) * e, cy = latEnY(this.centre.lat) * e;
    return {
      lon: xEnLon((px - this.largeur / 2 + cx) / e),
      lat: yEnLat((py - this.hauteur / 2 + cy) / e)
    };
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
        var dx = p.x - drag.x, dy = p.y - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) bouge = true;
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

    this._rendreContours(ctx);
    this._rendreRayon(ctx);
    this.cibles = [];
    this._rendreStations(ctx);
    this._rendreMarqueur(ctx);
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
        var x = lonEnX(trace[i][0]) * e + dx;
        var y = latEnY(trace[i][1]) * e + dy;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
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
      var x = lonEnX(jeu.lon[s] / 1e5) * e + dx;
      if (x < -marge || x > this.largeur + marge) continue;
      var y = latEnY(jeu.lat[s] / 1e5) * e + dy;
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
