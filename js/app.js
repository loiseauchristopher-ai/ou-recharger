/* Bornes de recharge — assemblage de l'interface.
 *
 * Toute la donnee est en memoire (57 000 stations en TypedArrays) : chaque
 * changement de filtre rebalaye l'ensemble, ce qui tient largement dans une
 * frame et evite d'avoir a maintenir des index incrementaux.
 */
(function (global) {
  'use strict';

  var B = global.Bornes;
  var $ = function (sel) { return document.querySelector(sel); };

  var SERVICES = [
    { cle: 'gratuit', bit: B.DRAPEAU.GRATUIT, libelle: 'Recharge gratuite' },
    { cle: 'cb', bit: B.DRAPEAU.CB, libelle: 'Paiement par carte bancaire' },
    { cle: 'acte', bit: B.DRAPEAU.PAIEMENT_ACTE, libelle: 'Paiement à l’acte (sans abonnement)' },
    { cle: 'libre', bit: B.DRAPEAU.ACCES_LIBRE, libelle: 'Accès libre' },
    { cle: 'pmr', bit: B.DRAPEAU.PMR, libelle: 'Accessible PMR' },
    { cle: 'resa', bit: B.DRAPEAU.RESERVATION, libelle: 'Réservation possible' },
    { cle: 'deuxroues', bit: B.DRAPEAU.DEUX_ROUES, libelle: 'Deux-roues' }
  ];

  var PRISES_UI = [
    { bit: B.PRISE.T2, libelle: 'Type 2', detail: 'standard' },
    { bit: B.PRISE.CCS, libelle: 'CCS', detail: 'Combo' },
    { bit: B.PRISE.CHADEMO, libelle: 'CHAdeMO', detail: '' },
    { bit: B.PRISE.EF, libelle: 'Prise E/F', detail: 'domestique' }
  ];

  var PUISSANCES = [
    { v: 0, libelle: 'Toutes' },
    { v: 7.4, libelle: '≥ 7,4 kW' },
    { v: 22, libelle: '≥ 22 kW' },
    { v: 50, libelle: '≥ 50 kW' },
    { v: 150, libelle: '≥ 150 kW' },
    { v: 300, libelle: '≥ 300 kW' }
  ];

  var DISPOS = [
    { cle: 'toutes', libelle: 'Toutes les stations', detail: '' },
    { cle: 'ouvertes', libelle: 'Ouvertes maintenant', detail: 'selon les horaires déclarés' },
    { cle: 'libres', libelle: 'Libres maintenant', detail: 'statut temps réel, là où il est publié' }
  ];

  var etat = {
    centre: null,            // { lat, lon, libelle }
    rayon: 10,
    puissanceMin: 0,
    prises: 0,
    reseaux: new Set(),
    services: new Set(),
    dispo: 'toutes',
    tri: 'distance',
    triForce: false,
    limite: 25
  };

  var jeu = null;
  var carte = null;
  var resultats = [];
  var tempsReel = { parStation: new Map(), fournisseurs: [], etat: 'inactif', erreur: null };

  /* --------------------------------------------------------------- Filtrage */

  function filtrer() {
    var n = jeu.taille;
    var out = [];
    var pmin = etat.puissanceMin * 10;
    var prises = etat.prises;
    var reseaux = etat.reseaux;
    var maintenant = new Date();
    var centre = etat.centre;
    var rayon = etat.rayon;

    /* Pre-decoupe grossiere en boite avant le calcul de distance exact. */
    var latMin = -1e9, latMax = 1e9, lonMin = -1e9, lonMax = 1e9;
    if (centre) {
      var dLat = rayon / 111.32;
      var dLon = rayon / (111.32 * Math.max(0.2, Math.cos(centre.lat * Math.PI / 180)));
      latMin = (centre.lat - dLat) * 1e5; latMax = (centre.lat + dLat) * 1e5;
      lonMin = (centre.lon - dLon) * 1e5; lonMax = (centre.lon + dLon) * 1e5;
    }

    var servicesActifs = SERVICES.filter(function (s) { return etat.services.has(s.cle); });
    var masqueServices = servicesActifs.reduce(function (m, s) { return m | s.bit; }, 0);

    for (var i = 0; i < n; i++) {
      if (jeu.puissance[i] < pmin) continue;
      if (centre) {
        if (jeu.lat[i] < latMin || jeu.lat[i] > latMax) continue;
        if (jeu.lon[i] < lonMin || jeu.lon[i] > lonMax) continue;
      }
      if (prises && (jeu.prises[i] & prises) !== prises) continue;
      if (masqueServices && (jeu.drapeaux[i] & masqueServices) !== masqueServices) continue;
      if (reseaux.size && !reseaux.has(jeu.reseau[i])) continue;

      if (etat.dispo === 'ouvertes') {
        if (!(jeu.drapeaux[i] & B.DRAPEAU.H24)) {
          if (B.horaires.etat(jeu.horaire(i), maintenant) !== 'ouvert') continue;
        }
      } else if (etat.dispo === 'libres') {
        var e = tempsReel.parStation.get(i);
        if (!e || !e.libre) continue;
      }

      var d = -1;
      if (centre) {
        d = B.distanceKm(centre.lat, centre.lon, jeu.lat[i] / 1e5, jeu.lon[i] / 1e5);
        if (d > rayon) continue;
      }
      out.push({ i: i, d: d });
    }

    var tri = etat.tri;
    out.sort(function (a, b) {
      if (tri === 'puissance') return jeu.puissance[b.i] - jeu.puissance[a.i] || a.d - b.d;
      if (tri === 'points') return nombrePoints(b.i) - nombrePoints(a.i) || a.d - b.d;
      if (tri === 'nom') return jeu.libelle(a.i).localeCompare(jeu.libelle(b.i), 'fr');
      if (a.d < 0) return jeu.puissance[b.i] - jeu.puissance[a.i];
      return a.d - b.d;
    });
    return out;
  }

  /* ----------------------------------------------------------------- Rendu */

  function couleurStation(i) {
    if (etat.dispo === 'libres' || tempsReel.parStation.size) {
      var e = tempsReel.parStation.get(i);
      if (e) {
        if (e.libre) return getComputedStyle(document.body).getPropertyValue('--ok').trim() || '#1a8f6a';
        if (e.occupe) return getComputedStyle(document.body).getPropertyValue('--occupe').trim() || '#d98324';
        if (e.hs) return getComputedStyle(document.body).getPropertyValue('--hs').trim() || '#c2413a';
      }
    }
    return B.palier(jeu.puissance[i] / 10).couleur;
  }

  /* Au-dela de ce seuil, la valeur declaree est presque toujours la puissance
   * cumulee de la station et non celle d'un point de charge. On l'affiche telle
   * quelle — c'est la donnee officielle — mais signalee comme douteuse. */
  var PUISSANCE_DOUTEUSE = 400;

  function formatKw(kw) {
    if (!kw) return 'n.c.';
    return (kw >= 10 ? Math.round(kw) : Math.round(kw * 10) / 10).toString().replace('.', ',') + ' kW';
  }

  function douteuse(i) { return jeu.kw(i) > PUISSANCE_DOUTEUSE; }

  function formatDistance(km) {
    if (km < 0) return '';
    return km < 1 ? Math.round(km * 1000) + ' m' : (km < 10 ? km.toFixed(1).replace('.', ',') : Math.round(km)) + ' km';
  }

  function badgesPrises(i) {
    return PRISES_UI.filter(function (p) { return jeu.prise(i, p.bit); })
      .map(function (p) { return '<span class="badge">' + p.libelle + '</span>'; }).join('');
  }

  /* Etat d'une station, dans l'ordre de fiabilite decroissante :
   * statut temps reel > horaires declares > rien de connu. */
  function disponibilite(i) {
    var e = tempsReel.parStation.get(i);
    if (e && e.total) {
      if (e.libre) {
        return { genre: 'temps-reel', classe: 'ok',
          texte: e.libre + ' libre' + (e.libre > 1 ? 's' : '') + ' sur ' + e.total };
      }
      if (e.occupe) {
        return { genre: 'temps-reel', classe: 'occupe',
          texte: e.occupe > 1 ? 'toutes en charge' : 'en charge' };
      }
      return { genre: 'temps-reel', classe: 'hs', texte: 'hors service' };
    }
    var h = B.horaires.etat(jeu.horaire(i), new Date());
    if (h === 'ouvert') {
      return { genre: 'horaires', classe: '', texte: 'ouverte — état des bornes non publié' };
    }
    if (h === 'ferme') {
      return { genre: 'horaires', classe: '', texte: 'fermée à cette heure' };
    }
    return { genre: 'inconnu', classe: '', texte: 'horaires non communiqués' };
  }

  /* Quand un flux temps reel suit la station, son decompte fait reference : il
   * est mesure, la ou nbre_pdc est declaratif — et les deux se contredisent
   * regulierement (7 points declares, 21 suivis rue de Lobau a Paris). */
  function nombrePoints(i) {
    var e = tempsReel.parStation.get(i);
    return e && e.total ? e.total : jeu.points[i];
  }

  function badgeDispo(i) {
    var d = disponibilite(i);
    var puce = d.genre === 'temps-reel' ? '● ' : '';
    return '<span class="badge ' + d.classe + (d.genre === 'temps-reel' ? ' direct' : '') + '"' +
      (d.genre === 'temps-reel' ? ' title="Statut temps réel"' : '') +
      '>' + puce + echapper(d.texte) + '</span>';
  }

  function echapper(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function rendreListe() {
    var liste = $('#liste-stations');
    var lot = resultats.slice(0, etat.limite);
    liste.innerHTML = lot.map(function (r) {
      var i = r.i;
      var p = B.palier(jeu.kw(i));
      var reseau = jeu.reseaux[jeu.reseau[i]];
      var nom = jeu.libelle(i);
      return '<li class="station" data-i="' + i + '" tabindex="0">' +
        '<div class="station-haut"><span class="station-nom">' + echapper(nom) + '</span>' +
        '<span class="station-distance">' + formatDistance(r.d) + '</span></div>' +
        (B.sansAccent(nom) === B.sansAccent(reseau) ? ''
          : '<div class="station-reseau">' + echapper(reseau) + '</div>') +
        '<div class="station-adresse">' + echapper(jeu.adresseComplete(i)) + '</div>' +
        '<div class="station-badges">' +
        '<span class="badge puissance" style="background:' + p.couleur + '"' +
        (douteuse(i) ? ' title="Valeur déclarée inhabituelle : il s’agit probablement de la puissance cumulée de la station."' : '') +
        '>' + formatKw(jeu.kw(i)) + (douteuse(i) ? ' ?' : '') + '</span>' +
        '<span class="badge nombre">' + nombrePoints(i) + ' point' +
        (nombrePoints(i) > 1 ? 's' : '') + ' de charge</span>' +
        badgeDispo(i) + badgesPrises(i) +
        (jeu.a(i, B.DRAPEAU.GRATUIT) ? '<span class="badge ok">gratuit</span>' : '') +
        (jeu.a(i, B.DRAPEAU.H24) ? '<span class="badge">24h/24</span>' : '') +
        '</div></li>';
    }).join('');

    $('#btn-plus').hidden = resultats.length <= etat.limite;
    $('#message-vide').hidden = resultats.length > 0;
    if (!resultats.length) {
      $('#message-vide').textContent = etat.centre
        ? 'Aucune station ne correspond dans un rayon de ' + etat.rayon + ' km. Élargissez le rayon ou assouplissez les filtres.'
        : 'Aucune station ne correspond à ces filtres.';
    }

    var pluriel = resultats.length > 1 ? 's' : '';
    var points = lot.length ? resultats.reduce(function (t, r) { return t + jeu.points[r.i]; }, 0) : 0;
    $('#titre-resultats').textContent = resultats.length.toLocaleString('fr-FR') +
      ' station' + pluriel + (points ? ' · ' + points.toLocaleString('fr-FR') + ' points de charge' : '');
  }

  function rendreLegende() {
    var tempsReelActif = tempsReel.parStation.size > 0;
    var lignes = tempsReelActif
      ? [{ c: 'var(--ok)', t: 'Au moins un point libre' },
         { c: 'var(--occupe)', t: 'Tous en charge' },
         { c: 'var(--hs)', t: 'Hors service' }]
        .concat(B.PALIERS.map(function (p) { return { c: p.couleur, t: p.libelle + ' (sans temps réel)' }; }))
      : B.PALIERS.map(function (p) { return { c: p.couleur, t: p.libelle + ' — ' + p.detail }; });

    var el = $('#legende');
    var deployee = el.classList.contains('deployee');
    el.innerHTML = '<div class="legende-titre">' +
      (tempsReelActif ? 'Disponibilité' : 'Puissance maximale') + '</div>' +
      lignes.map(function (l) {
        return '<div class="legende-ligne"><span class="puce" style="background:' + l.c + '"></span>' +
          echapper(l.t) + '</div>';
      }).join('') +
      /* Au doigt, il n'y a pas de survol : la legende se deplie sur appui. */
      '<button type="button" class="legende-bascule">' +
      (deployee ? 'Réduire' : 'Voir la légende') + '</button>';
    el.querySelector('.legende-bascule').addEventListener('click', function () {
      el.classList.toggle('deployee');
      rendreLegende();
    });
  }

  /* Sans lieu de reference, trier par distance n'a pas de sens : on bascule sur
   * la puissance et on le montre dans le selecteur. */
  function ajusterTri() {
    var select = $('#champ-tri');
    var optionDistance = select.querySelector('option[value="distance"]');
    optionDistance.disabled = !etat.centre;
    optionDistance.textContent = etat.centre ? 'Distance' : 'Distance (choisissez un lieu)';
    if (!etat.centre && etat.tri === 'distance') {
      etat.tri = 'puissance';
      etat.triForce = true;
      select.value = 'puissance';
    } else if (etat.centre && etat.triForce) {
      /* On avait bascule faute de point de reference : maintenant qu'il y en a
       * un, la distance redevient le tri le plus utile. */
      etat.tri = 'distance';
      etat.triForce = false;
      select.value = 'distance';
    }
  }

  function rafraichir(recadrer) {
    ajusterTri();
    resultats = filtrer();
    rendreListe();
    rendreLegende();
    majPastilleFiltres();
    var indices = new Uint32Array(resultats.length);
    for (var k = 0; k < resultats.length; k++) indices[k] = resultats[k].i;
    carte.definirDonnees(jeu, indices, couleurStation);
    if (recadrer && etat.centre) carte.cadrerRayon(etat.centre.lat, etat.centre.lon, etat.rayon);
  }

  /* ------------------------------------------------------------- Fiche detail */

  /* Applications de navigation proposees, selon l'appareil. Sur iPhone,
   * maps.apple.com bascule directement dans Plans ; ailleurs on s'appuie sur
   * Google Maps et Waze, qui ouvrent leur application quand elle est installee. */
  function applisNavigation(lat, lon) {
    var ua = navigator.userAgent || '';
    var pomme = /iPad|iPhone|iPod/.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    var coords = lat + ',' + lon;
    var applis = [];
    if (pomme) {
      applis.push({ nom: 'Plans', url: 'https://maps.apple.com/?daddr=' + coords + '&dirflg=d' });
    }
    applis.push({
      nom: 'Google Maps',
      url: 'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + coords
    });
    applis.push({ nom: 'Waze', url: 'https://waze.com/ul?ll=' + coords + '&navigate=yes' });
    if (!pomme && !/Android/.test(ua)) {
      applis.push({
        nom: 'OpenStreetMap',
        url: 'https://www.openstreetmap.org/?mlat=' + lat + '&mlon=' + lon +
          '#map=18/' + lat + '/' + lon
      });
    }
    return applis;
  }

  /* Ouvrir une application de navigation depuis un cadre restreint.
   *
   * Un simple lien target="_blank" ne fait rien quand le cadre n'accorde pas
   * allow-popups : le clic est avale sans message. On essaie donc, du moins
   * intrusif au plus intrusif : un nouvel onglet, puis la navigation de la page
   * hote. Si les deux sont refuses, on ne navigue pas d'autorite — cela
   * remplacerait l'application par la carte de destination et ferait perdre la
   * recherche en cours : on l'explique et on laisse le choix. */
  function ouvrirNavigation(url, ev) {
    if (ev) ev.preventDefault();

    try {
      /* Sans 'noopener' dans les options : avec, l'appel renvoie null meme
       * lorsqu'il reussit, et on ne saurait pas distinguer succes et blocage.
       * On coupe donc le lien vers l'ouvrante juste apres. */
      var onglet = window.open(url, '_blank');
      if (onglet) {
        try { onglet.opener = null; } catch (e2) { /* origine differente */ }
        return true;
      }
    } catch (e) { /* cadre sans allow-popups */ }

    try {
      if (window.top && window.top !== window.self) {
        window.top.location.href = url;
        return true;
      }
    } catch (e) { /* cadre sans allow-top-navigation */ }

    if (!estEncadre()) {
      window.location.href = url;
      return true;
    }

    /* Le message doit apparaitre dans la fiche : sur telephone celle-ci
     * recouvre la carte, un bandeau y serait invisible. */
    var zone = $('#fiche-message');
    if (zone) {
      zone.innerHTML = '';
      var texte = document.createElement('p');
      texte.textContent = 'Le cadre d’affichage empêche d’ouvrir une application ' +
        'externe. Copiez les coordonnées ci-dessous, ou ouvrez la carte ici — vous ' +
        'perdrez alors la recherche en cours.';
      var bouton = document.createElement('button');
      bouton.type = 'button';
      bouton.className = 'bouton';
      bouton.textContent = 'Ouvrir ici quand même';
      bouton.addEventListener('click', function () { window.location.href = url; });
      zone.appendChild(texte);
      zone.appendChild(bouton);
      zone.hidden = false;
    }
    var champ = $('#fiche-coords');
    if (champ) { champ.focus(); champ.select(); }
    return false;
  }

  /* Le presse-papiers peut etre refuse dans un cadre : on retombe alors sur une
   * selection manuelle, pour que les coordonnees restent recuperables. */
  function copier(texte, bouton) {
    function confirme(ok) {
      var initial = bouton.dataset.libelle || bouton.textContent;
      bouton.dataset.libelle = initial;
      bouton.textContent = ok ? 'Copié' : 'Sélectionnez et copiez';
      if (!ok) {
        var champ = $('#fiche-coords');
        if (champ) { champ.focus(); champ.select(); }
      }
      setTimeout(function () { bouton.textContent = initial; }, 2500);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(texte).then(function () { confirme(true); },
        function () { confirme(false); });
    } else {
      confirme(false);
    }
  }

  function ouvrirFiche(i) {
    var e = tempsReel.parStation.get(i);
    var etatHoraire = B.horaires.etat(jeu.horaire(i), new Date());
    var lignes = [
      ['Réseau', echapper(jeu.reseaux[jeu.reseau[i]])],
      ['Adresse', echapper(jeu.adresseComplete(i))],
      ['Puissance max.', formatKw(jeu.kw(i)) + ' — ' + B.palier(jeu.kw(i)).libelle.toLowerCase() +
        (douteuse(i) ? ' <em>(valeur déclarée inhabituelle : probablement la puissance cumulée de la station)</em>' : '')],
      ['Points de charge', nombrePoints(i) +
        (nombrePoints(i) !== jeu.points[i] ? ' (suivis en temps réel ; ' + jeu.points[i] + ' déclarés)' : '')],
      ['Prises', PRISES_UI.filter(function (p) { return jeu.prise(i, p.bit); })
        .map(function (p) { return p.libelle; }).join(', ') || 'non précisées'],
      ['Horaires', echapper(B.horaires.resume(jeu.horaire(i))) +
        (etatHoraire === 'inconnu' ? '' : ' <strong>(' + (etatHoraire === 'ouvert' ? 'ouvert' : 'fermé') + ' maintenant)</strong>')],
      ['Implantation', echapper(jeu.implantations[jeu.implantation[i]] || 'non précisée')],
      ['Accès', [
        jeu.a(i, B.DRAPEAU.ACCES_LIBRE) ? 'libre' : null,
        jeu.a(i, B.DRAPEAU.PMR) ? 'PMR' : null,
        jeu.a(i, B.DRAPEAU.RESERVATION) ? 'réservable' : null,
        jeu.a(i, B.DRAPEAU.DEUX_ROUES) ? 'deux-roues' : null
      ].filter(Boolean).join(', ') || 'non précisé'],
      ['Paiement', jeu.a(i, B.DRAPEAU.GRATUIT) ? 'gratuit' : [
        jeu.a(i, B.DRAPEAU.CB) ? 'carte bancaire' : null,
        jeu.a(i, B.DRAPEAU.PAIEMENT_ACTE) ? 'à l’acte' : null
      ].filter(Boolean).join(', ') || 'non précisé'],
      ['Mise à jour', echapper(jeu.maj(i) || 'inconnue')]
    ];
    if (e && e.total) {
      lignes.unshift(['Temps réel', '<strong>' + e.libre + ' libre' + (e.libre > 1 ? 's' : '') +
        '</strong> · ' + e.occupe + ' en charge' + (e.hs ? ' · ' + e.hs + ' hors service' : '') +
        ' (' + e.total + ' point' + (e.total > 1 ? 's' : '') + ' suivi' + (e.total > 1 ? 's' : '') + ')']);
    } else {
      lignes.unshift(['Disponibilité', echapper(disponibilite(i).texte)]);
    }

    var lat = jeu.latitude(i), lon = jeu.longitude(i);
    $('#fiche-contenu').innerHTML =
      '<h2>' + echapper(jeu.libelle(i)) + '</h2>' +
      '<p class="fiche-reseau">' + echapper(jeu.reseaux[jeu.reseau[i]]) + '</p>' +
      '<div class="station-badges">' +
      '<span class="badge puissance" style="background:' + B.palier(jeu.kw(i)).couleur + '">' +
      formatKw(jeu.kw(i)) + '</span>' + badgeDispo(i) + '</div>' +
      '<dl>' + lignes.map(function (l) {
        return '<dt>' + l[0] + '</dt><dd>' + l[1] + '</dd>';
      }).join('') + '</dl>' +
      '<p class="fiche-titre-actions">Y aller</p>' +
      '<div class="fiche-actions">' +
      applisNavigation(lat, lon).map(function (a, rang) {
        return '<a class="bouton lien-navigation' + (rang === 0 ? ' primaire' : '') +
          '" target="_blank" rel="noopener" href="' + a.url + '">' + a.nom + '</a>';
      }).join('') +
      '</div>' +
      '<div class="fiche-message" id="fiche-message" hidden></div>' +
      '<div class="fiche-coords">' +
      '<input id="fiche-coords" type="text" readonly value="' + lat + ', ' + lon + '"' +
      ' aria-label="Coordonnées GPS de la station">' +
      '<button type="button" class="bouton" id="btn-copier-coords">Copier</button>' +
      '</div>' +
      '<p class="fiche-note">Données déclaratives des opérateurs, consolidées par data.gouv.fr. ' +
      (e ? 'Le statut temps réel provient de ' + echapper(tempsReel.fournisseurs.map(function (f) { return f.nom; }).join(', ')) + '.'
         : 'Aucun flux temps réel ne couvre cette station : la disponibilité affichée est celle des horaires déclarés.') +
      '</p>';
    $('#btn-copier-coords').addEventListener('click', function () {
      copier(lat + ', ' + lon, this);
    });
    Array.prototype.forEach.call(
      document.querySelectorAll('#fiche .lien-navigation'), function (lien) {
        lien.addEventListener('click', function (ev) {
          ouvrirNavigation(lien.href, ev);
        });
      });
    $('#fiche').hidden = false;
    carte.selection = i;
    carte.dessiner();
    document.querySelectorAll('.station').forEach(function (el) {
      el.classList.toggle('active', +el.dataset.i === i);
    });
  }

  function fermerFiche() {
    $('#fiche').hidden = true;
    carte.selection = -1;
    carte.dessiner();
    document.querySelectorAll('.station.active').forEach(function (el) { el.classList.remove('active'); });
  }

  /* -------------------------------------------------------------- Recherche */

  /* Recherche de lieu : d'abord les communes de l'instantane (instantane, marche
   * hors ligne), completee par la Base Adresse Nationale quand elle repond. */
  function suggestionsLocales(q) {
    var norm = B.sansAccent(q).trim();
    if (norm.length < 2) return [];
    var estCp = /^\d{2,5}$/.test(norm);
    var vus = new Map();
    for (var i = 0; i < jeu.taille; i++) {
      var ok = estCp ? jeu.cp(i).indexOf(norm) === 0
                     : jeu.villesNorm[jeu.villeIdx[i]].indexOf(norm) === 0;
      if (!ok) continue;
      var cle = jeu.villeIdx[i] + ':' + jeu.cpIdx[i];
      var s = vus.get(cle);
      if (!s) {
        vus.set(cle, s = { libelle: jeu.ville(i), detail: jeu.cp(i), n: 0, sLat: 0, sLon: 0 });
      }
      s.n++; s.sLat += jeu.latitude(i); s.sLon += jeu.longitude(i);
      if (vus.size > 400) break;
    }
    return Array.from(vus.values())
      .sort(function (a, b) { return b.n - a.n; })
      .slice(0, 6)
      .map(function (s) {
        var stations = s.n + ' station' + (s.n > 1 ? 's' : '');
        return {
          libelle: s.libelle,
          detail: s.detail ? s.detail + ' · ' + stations : stations,
          lat: s.sLat / s.n, lon: s.sLon / s.n, source: 'local'
        };
      });
  }

  function suggestionsBan(q) {
    return fetch('https://api-adresse.data.gouv.fr/search/?limit=5&q=' + encodeURIComponent(q))
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
      .then(function (j) {
        return (j.features || []).map(function (f) {
          return {
            libelle: f.properties.label,
            detail: f.properties.context || '',
            lat: f.geometry.coordinates[1],
            lon: f.geometry.coordinates[0],
            source: 'ban'
          };
        });
      })
      .catch(function () { return []; });
  }

  function afficherSuggestions(liste) {
    var ul = $('#suggestions');
    if (!liste.length) { ul.hidden = true; ul.innerHTML = ''; return; }
    ul.innerHTML = liste.map(function (s, k) {
      return '<li data-k="' + k + '" role="option">' + echapper(s.libelle) +
        (s.detail ? ' <span class="sug-detail">' + echapper(s.detail) + '</span>' : '') + '</li>';
    }).join('');
    ul.hidden = false;
    ul._liste = liste;
  }

  function choisirLieu(s) {
    etat.centre = { lat: s.lat, lon: s.lon, libelle: s.libelle };
    $('#champ-lieu').value = s.libelle;
    $('#suggestions').hidden = true;
    $('#bloc-rayon').hidden = false;
    $('#autour-de').textContent = 'Autour de ' + s.libelle;
    carte.marqueur = { lat: s.lat, lon: s.lon, rayonKm: etat.rayon };
    rafraichir(true);
    majTempsReel();
  }

  /* La page est-elle affichee a l'interieur d'un cadre ? Un iframe sans
   * autorisation explicite refuse la geolocalisation quels que soient les
   * reglages du navigateur : dire « autorisez-la dans votre navigateur »
   * enverrait alors l'utilisateur chercher un reglage qui n'y changera rien. */
  function estEncadre() {
    try { return window.self !== window.top; } catch (e) { return true; }
  }

  var MOTIFS_GEOLOC = {
    1: 'Géolocalisation refusée. Autorisez-la dans votre navigateur, ou saisissez une ville ci-dessus.',
    2: 'Position indisponible pour le moment. Saisissez une ville ci-dessus.',
    3: 'La localisation a mis trop de temps à répondre. Saisissez une ville ci-dessus.'
  };

  var REFUS_ENCADRE = 'Cette page est affichée dans un cadre qui bloque la ' +
    'géolocalisation — ce n’est pas un réglage de votre téléphone. Ouvrez-la ' +
    'dans un onglet pour l’utiliser, ou saisissez une ville ci-dessus.';

  function ouvrirEnPleinEcran() {
    var onglet = window.open(window.location.href, '_blank', 'noopener');
    if (!onglet) {
      bandeau('Le cadre a bloqué l’ouverture. Copiez cette adresse dans votre ' +
        'navigateur : ' + window.location.href, true);
    }
  }

  /* `discret` : tentative automatique au chargement — on ne derange pas
   * l'utilisateur avec un message s'il a simplement refuse. */
  function geolocaliser(discret) {
    var btn = $('#btn-geoloc');
    if (!navigator.geolocation) {
      if (!discret) bandeau('Ce navigateur ne fournit pas la géolocalisation. Saisissez une ville ci-dessus.', true);
      return;
    }
    btn.disabled = true;
    if (!discret) bandeau('Recherche de votre position…', true);

    /* Le delai de l'API ne demarre qu'une fois l'autorisation accordee : si
     * l'invite du navigateur reste sans reponse, aucun rappel n'arrive jamais.
     * D'ou ce garde-fou, qui rend la main plutot que de laisser tourner. */
    var repondu = false;
    var abandon = setTimeout(function () {
      if (repondu) return;
      repondu = true;
      btn.disabled = false;
      if (!discret) {
        bandeau('Toujours pas de réponse à la demande de position. ' +
          'Saisissez une ville ci-dessus, ou réessayez.', true);
      } else {
        bandeau(null, true);
      }
    }, 12000);

    navigator.geolocation.getCurrentPosition(function (p) {
      if (repondu) return;
      repondu = true; clearTimeout(abandon);
      btn.disabled = false;
      bandeau(null, true);
      choisirLieu({ lat: p.coords.latitude, lon: p.coords.longitude, libelle: 'Ma position' });
    }, function (err) {
      if (repondu) return;
      repondu = true; clearTimeout(abandon);
      btn.disabled = false;
      if (discret) { bandeau(null, true); return; }
      var code = err && err.code;
      if (code === 1 && estEncadre()) {
        bandeau(REFUS_ENCADRE, true, { libelle: 'Ouvrir dans un onglet', action: ouvrirEnPleinEcran });
      } else {
        bandeau(MOTIFS_GEOLOC[code] || 'Position indisponible. Saisissez une ville ci-dessus.', true);
      }
      $('#champ-lieu').focus();
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  }

  /* Au demarrage, on se cale sur la position si l'autorisation est deja acquise ;
   * sinon on la demande une fois, l'app restant utilisable en cas de refus. */
  function geolocaliserAuDemarrage() {
    if (!navigator.geolocation) return;
    if (!navigator.permissions || !navigator.permissions.query) {
      geolocaliser(true);
      return;
    }
    navigator.permissions.query({ name: 'geolocation' }).then(function (etatPerm) {
      geolocaliser(etatPerm.state !== 'prompt');
    }, function () { geolocaliser(true); });
  }

  /* -------------------------------------------------------------- Temps reel */

  function majTempsReel() {
    var bbox = carte.emprise();
    var couvert = B.dispo.fournisseurs.filter(function (f) { return B.dispo.chevauche(f.zone, bbox); });
    var aide = $('#aide-dispo');

    if (!couvert.length) {
      tempsReel = { parStation: new Map(), fournisseurs: [], etat: 'hors-zone', erreur: null };
      aide.textContent = '« Ouvertes maintenant » s’appuie sur les horaires déclarés. ' +
        'Aucun flux temps réel ne couvre la zone affichée — seul Belib’ (Paris) en publie un ouvert à ce jour.';
      bandeau(null);
      if (etat.dispo === 'libres') { etat.dispo = 'ouvertes'; rendreChipsDispo(); }
      rafraichir();
      return;
    }

    aide.textContent = 'Statut temps réel publié sur une partie de la zone affichée par ' +
      couvert.map(function (f) { return f.nom; }).join(', ') +
      '. Ailleurs, seuls les horaires déclarés sont connus.';
    tempsReel.etat = 'chargement';
    bandeau('Récupération des statuts temps réel…');

    B.dispo.rafraichir(bbox).then(function (res) {
      if (res.erreurs.length || !res.points.length) {
        tempsReel = { parStation: new Map(), fournisseurs: [], etat: 'erreur', erreur: res.erreurs[0] };
        bandeau('Statut temps réel indisponible (flux injoignable depuis ce contexte). ' +
          'Les filtres et la recherche restent complets.');
        if (etat.dispo === 'libres') { etat.dispo = 'ouvertes'; rendreChipsDispo(); }
        rafraichir();
        return;
      }
      tempsReel = {
        parStation: B.dispo.apparier(jeu, res.points),
        fournisseurs: res.fournisseurs,
        etat: 'ok',
        erreur: null
      };
      var suivies = tempsReel.parStation.size;
      bandeau('Temps réel : ' + res.points.length + ' points suivis sur ' + suivies +
        ' stations — ' + res.fournisseurs.map(function (f) { return f.nom; }).join(', ') + '.');
      rafraichir();
    });
  }

  var bandeauPrioritaireJusqua = 0;

  function bandeau(texte, prioritaire, bouton) {
    var el = $('#bandeau-carte');
    if (!prioritaire && Date.now() < bandeauPrioritaireJusqua) return;
    if (prioritaire) bandeauPrioritaireJusqua = texte ? Date.now() + 15000 : 0;
    if (!texte) { el.hidden = true; el.textContent = ''; return; }
    el.textContent = texte;

    var fermer = document.createElement('button');
    fermer.type = 'button';
    fermer.className = 'bandeau-fermer';
    fermer.setAttribute('aria-label', 'Masquer ce message');
    fermer.textContent = '×';
    fermer.addEventListener('click', function () {
      bandeauPrioritaireJusqua = 0;
      el.hidden = true;
    });
    el.appendChild(fermer);

    if (bouton) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'bouton bandeau-action';
      b.textContent = bouton.libelle;
      b.addEventListener('click', bouton.action);
      el.appendChild(b);
    }
    el.hidden = false;
  }

  /* ------------------------------------------------------------- Construction */

  function chip(libelle, detail, actif, onClic, couleur) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.setAttribute('aria-pressed', actif ? 'true' : 'false');
    b.innerHTML = (couleur ? '<span class="puce" style="background:' + couleur + '"></span>' : '') +
      echapper(libelle) + (detail ? ' <span class="chip-detail">' + echapper(detail) + '</span>' : '');
    b.addEventListener('click', onClic);
    return b;
  }

  function rendreChipsPuissance() {
    var box = $('#chips-puissance');
    box.innerHTML = '';
    PUISSANCES.forEach(function (p) {
      var couleur = p.v ? B.palier(p.v + 0.01).couleur : null;
      box.appendChild(chip(p.libelle, '', etat.puissanceMin === p.v, function () {
        etat.puissanceMin = p.v;
        rendreChipsPuissance();
        rafraichir();
      }, couleur));
    });
  }

  function rendreChipsDispo() {
    var box = $('#chips-dispo');
    box.innerHTML = '';
    DISPOS.forEach(function (d) {
      box.appendChild(chip(d.libelle, d.detail, etat.dispo === d.cle, function () {
        etat.dispo = d.cle;
        rendreChipsDispo();
        if (d.cle === 'libres' && tempsReel.etat !== 'ok') majTempsReel();
        else rafraichir();
      }));
    });
  }

  function rendreChipsPrises() {
    var box = $('#chips-prises');
    box.innerHTML = '';
    PRISES_UI.forEach(function (p) {
      box.appendChild(chip(p.libelle, p.detail, (etat.prises & p.bit) !== 0, function () {
        etat.prises ^= p.bit;
        rendreChipsPrises();
        rafraichir();
      }));
    });
  }

  function rendreChipsServices() {
    var box = $('#chips-services');
    box.innerHTML = '';
    SERVICES.forEach(function (s) {
      box.appendChild(chip(s.libelle, '', etat.services.has(s.cle), function () {
        if (etat.services.has(s.cle)) etat.services.delete(s.cle);
        else etat.services.add(s.cle);
        rendreChipsServices();
        rafraichir();
      }));
    });
  }

  function rendreReseaux() {
    var q = B.sansAccent($('#champ-reseau').value.trim());
    var box = $('#liste-reseaux');
    var liste = jeu.reseauxClasses.filter(function (r) {
      return !q || B.sansAccent(r.nom).indexOf(q) >= 0;
    });
    var visibles = liste.slice(0, 120);
    box.innerHTML = visibles.map(function (r) {
      return '<label class="ligne-reseau"><input type="checkbox" value="' + r.idx + '"' +
        (etat.reseaux.has(r.idx) ? ' checked' : '') + '>' +
        '<span class="nom">' + echapper(r.nom) + '</span>' +
        '<span class="n">' + r.stations.toLocaleString('fr-FR') + '</span></label>';
    }).join('') + (liste.length > visibles.length
      ? '<p class="aide">… ' + (liste.length - visibles.length) + ' autres réseaux, affinez la recherche.</p>'
      : '');
    $('#compte-reseaux').textContent = etat.reseaux.size ? etat.reseaux.size + ' sélectionné' +
      (etat.reseaux.size > 1 ? 's' : '') : '';
    $('#btn-reseaux-vider').hidden = etat.reseaux.size === 0;
  }

  function majPastilleFiltres() {
    var n = (etat.puissanceMin ? 1 : 0) + (etat.prises ? 1 : 0) + etat.services.size +
      (etat.reseaux.size ? 1 : 0) + (etat.dispo !== 'toutes' ? 1 : 0);
    var p = $('#pastille-filtres');
    p.textContent = n;
    p.hidden = n === 0;
  }

  function reinitialiser() {
    etat.puissanceMin = 0;
    etat.prises = 0;
    etat.reseaux.clear();
    etat.services.clear();
    etat.dispo = 'toutes';
    etat.limite = 25;
    $('#champ-reseau').value = '';
    rendreChipsPuissance(); rendreChipsDispo(); rendreChipsPrises();
    rendreChipsServices(); rendreReseaux();
    rafraichir();
  }

  /* -------------------------------------------------------------- Demarrage */

  function demarrer() {
    jeu = new B.Jeu(global.SNAPSHOT_STATIONS);
    $('#compteur-total').textContent = jeu.taille.toLocaleString('fr-FR') + ' stations · ' +
      jeu.nbPoints.toLocaleString('fr-FR') + ' points de charge';
    $('#pied-source').textContent = jeu.source +
      ' — instantané embarqué, dernière mise à jour des données : ' +
      (jeu.majs.slice().sort().pop() || 'n.c.') + '.';

    carte = new B.Carte($('#carte'), {
      surClicStation: ouvrirFiche,
      surClicGroupe: function (g) {
        carte.centrerSur(carte.versGeo(g.x, g.y).lat, carte.versGeo(g.x, g.y).lon, carte.zoom + 2);
      },
      surDeplacement: deplacementCarte
    });
    carte.definirContours(global.FOND_CARTE || []);
    carte.redimensionner();
    B.carteCourante = carte;      // point d'entree pour les tests de bout en bout

    rendreChipsPuissance(); rendreChipsDispo(); rendreChipsPrises();
    rendreChipsServices(); rendreReseaux();
    rafraichir();
    majTempsReel();
    $('#chargement').hidden = true;
    geolocaliserAuDemarrage();
  }

  var minuteurDeplacement = null;
  function deplacementCarte() {
    clearTimeout(minuteurDeplacement);
    minuteurDeplacement = setTimeout(function () {
      if (etat.dispo === 'libres' || tempsReel.parStation.size || tempsReel.etat === 'inactif') {
        majTempsReel();
      }
    }, 700);
  }

  function brancherInterface() {
    var champ = $('#champ-lieu');
    var minuteur = null;

    champ.addEventListener('input', function () {
      clearTimeout(minuteur);
      var q = champ.value.trim();
      if (q.length < 2) { $('#suggestions').hidden = true; return; }
      afficherSuggestions(suggestionsLocales(q));
      minuteur = setTimeout(function () {
        suggestionsBan(q).then(function (ban) {
          if (champ.value.trim() !== q) return;
          var locales = suggestionsLocales(q);
          var vus = new Set(locales.map(function (s) { return B.sansAccent(s.libelle); }));
          afficherSuggestions(locales.concat(ban.filter(function (s) {
            return !vus.has(B.sansAccent(s.libelle));
          })));
        });
      }, 250);
    });

    $('#suggestions').addEventListener('click', function (ev) {
      var li = ev.target.closest('li');
      if (li) choisirLieu(this._liste[+li.dataset.k]);
    });

    document.addEventListener('click', function (ev) {
      if (!ev.target.closest('.recherche')) $('#suggestions').hidden = true;
    });

    $('#form-recherche').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var q = champ.value.trim();
      if (!q) return;
      var ul = $('#suggestions');
      if (ul._liste && ul._liste.length) { choisirLieu(ul._liste[0]); return; }
      var locales = suggestionsLocales(q);
      if (locales.length) { choisirLieu(locales[0]); return; }
      suggestionsBan(q).then(function (ban) {
        if (ban.length) choisirLieu(ban[0]);
        else $('#message-vide').textContent = 'Lieu introuvable : ' + q;
      });
    });

    $('#btn-geoloc').addEventListener('click', function () { geolocaliser(false); });

    $('#champ-rayon').addEventListener('input', function () {
      etat.rayon = +this.value;
      $('#valeur-rayon').textContent = etat.rayon + ' km';
      if (carte.marqueur) carte.marqueur.rayonKm = etat.rayon;
      rafraichir();
    });
    $('#champ-rayon').addEventListener('change', function () {
      if (etat.centre) carte.cadrerRayon(etat.centre.lat, etat.centre.lon, etat.rayon);
    });

    $('#champ-tri').addEventListener('change', function () {
      etat.tri = this.value;
      rafraichir();
    });

    $('#champ-reseau').addEventListener('input', rendreReseaux);
    $('#liste-reseaux').addEventListener('change', function (ev) {
      var idx = +ev.target.value;
      if (ev.target.checked) etat.reseaux.add(idx); else etat.reseaux.delete(idx);
      $('#compte-reseaux').textContent = etat.reseaux.size ? etat.reseaux.size + ' sélectionné' +
        (etat.reseaux.size > 1 ? 's' : '') : '';
      $('#btn-reseaux-vider').hidden = etat.reseaux.size === 0;
      rafraichir();
    });
    $('#btn-reseaux-vider').addEventListener('click', function () {
      etat.reseaux.clear();
      rendreReseaux();
      rafraichir();
    });

    $('#btn-reinit').addEventListener('click', reinitialiser);
    $('#btn-plus').addEventListener('click', function () {
      etat.limite += 25;
      rendreListe();
    });

    $('#liste-stations').addEventListener('click', function (ev) {
      var li = ev.target.closest('.station');
      if (!li) return;
      var i = +li.dataset.i;
      ouvrirFiche(i);
      carte.centrerSur(jeu.latitude(i), jeu.longitude(i), Math.max(carte.zoom, 13));
    });
    $('#liste-stations').addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      var li = ev.target.closest('.station');
      if (!li) return;
      ev.preventDefault();
      ouvrirFiche(+li.dataset.i);
    });

    $('#btn-fermer-fiche').addEventListener('click', fermerFiche);
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') fermerFiche();
    });

    $('#btn-zoom-plus').addEventListener('click', function () { carte.zoomer(1); });
    $('#btn-zoom-moins').addEventListener('click', function () { carte.zoomer(-1); });
    $('#btn-france').addEventListener('click', function () {
      etat.centre = null;
      carte.marqueur = null;
      $('#bloc-rayon').hidden = true;
      carte.centrerSur(46.7, 2.5, 5.2);
      rafraichir();
    });

    $('#btn-filtres').addEventListener('click', function () {
      var ouvert = $('#panneau-filtres').classList.toggle('ouvert');
      this.setAttribute('aria-expanded', ouvert ? 'true' : 'false');
    });

    global.addEventListener('resize', function () { carte.redimensionner(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { brancherInterface(); demarrer(); });
  } else {
    brancherInterface();
    demarrer();
  }
})(window);
