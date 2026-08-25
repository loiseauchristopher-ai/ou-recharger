/* Lecture du champ « horaires » IRVE (syntaxe opening_hours d'OpenStreetMap).
 *
 * Le jeu contient 1 400 ecritures differentes ; 95 % sont « 24/7 ». On couvre les
 * formes reellement rencontrees : « 24/7 », « Mo-Fr 09:00-19:00 »,
 * « Mo-Su 00:00-23:57 », « Sa,Mo,Th 08:00-18:00 », listes separees par virgules,
 * plages passant minuit. Le reste retourne « inconnu » plutot que de bluffer.
 */
(function (global) {
  'use strict';

  var JOURS = { mo: 0, tu: 1, we: 2, th: 3, fr: 4, sa: 5, su: 6 };
  var JOURS_FR = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

  function minutes(hhmm) {
    var m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
    if (!m) return null;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  }

  /* Renvoie 7 tableaux d'intervalles [debut, fin) en minutes, ou null si illisible. */
  function analyser(texte) {
    var s = (texte || '').trim().toLowerCase();
    if (!s) return null;
    if (/^24\/7$/.test(s) || /^24h?\/?24/.test(s) || /^0?0:00-24:00$/.test(s)) {
      return { permanent: true, semaine: null };
    }

    var semaine = [[], [], [], [], [], [], []];
    var reconnu = false;
    var joursCourants = null;
    /* « Sa,Mo,Th 08:00-18:00 » : les jours s'accumulent jusqu'a la plage horaire. */
    var joursEnAttente = [];

    s.split(/[;,]/).forEach(function (bloc) {
      bloc = bloc.trim();
      if (!bloc) return;

      var jours = [];
      var reste = bloc;
      var mJours = /^((?:mo|tu|we|th|fr|sa|su)(?:\s*-\s*(?:mo|tu|we|th|fr|sa|su))?)\s*(.*)$/.exec(bloc);
      if (mJours) {
        var spec = mJours[1].replace(/\s+/g, '');
        reste = mJours[2].trim();
        if (spec.indexOf('-') > 0) {
          var bornes = spec.split('-');
          var a = JOURS[bornes[0]], b = JOURS[bornes[1]];
          if (a === undefined || b === undefined) return;
          for (var j = a; ; j = (j + 1) % 7) { jours.push(j); if (j === b) break; }
        } else {
          jours = [JOURS[spec]];
        }
        joursCourants = jours;
      } else if (joursCourants && /^\d{1,2}:\d{2}/.test(bloc)) {
        /* « Mo 08:00-12:00, 14:00-19:00 » : la plage herite des jours precedents. */
        jours = joursCourants;
      } else {
        return;
      }

      if (!reste) {                       // jours seuls : on attend la plage du bloc suivant
        jours.forEach(function (j) {
          if (joursEnAttente.indexOf(j) < 0) joursEnAttente.push(j);
        });
        return;
      }
      if (/^(off|closed|ferme)/.test(reste)) { reconnu = true; return; }

      var plages = reste.match(/\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}/g);
      if (!plages) return;
      if (joursEnAttente.length) {
        joursEnAttente.forEach(function (j) { if (jours.indexOf(j) < 0) jours.push(j); });
        joursEnAttente = [];
      }
      plages.forEach(function (plage) {
        var bouts = plage.split('-');
        var d = minutes(bouts[0]), f = minutes(bouts[1]);
        if (d === null || f === null) return;
        if (f === 0 || f <= d) f = 1440;   // « 00:00-00:00 » / plage passant minuit
        reconnu = true;
        jours.forEach(function (j) { if (semaine[j]) semaine[j].push([d, f]); });
      });
    });

    if (!reconnu) return null;

    /* « Mo-Su 00:00-23:57 » et compagnie : c'est du 24/7 deguise. */
    var permanent = semaine.every(function (jour) {
      return jour.some(function (p) { return p[0] <= 1 && p[1] >= 1435; });
    });
    return { permanent: permanent, semaine: semaine };
  }

  /* 'ouvert' | 'ferme' | 'inconnu' */
  function etat(texte, date) {
    var h = analyser(texte);
    if (!h) return 'inconnu';
    if (h.permanent) return 'ouvert';
    var d = date || new Date();
    var jour = (d.getDay() + 6) % 7;              // JS : 0 = dimanche
    var m = d.getHours() * 60 + d.getMinutes();
    var plages = h.semaine[jour] || [];
    for (var i = 0; i < plages.length; i++) {
      if (m >= plages[i][0] && m < plages[i][1]) return 'ouvert';
    }
    return 'ferme';
  }

  function hhmm(m) {
    return String(Math.floor(m / 60)).padStart(2, '0') + 'h' +
      (m % 60 ? String(m % 60).padStart(2, '0') : '');
  }

  /* Resume lisible : « 24h/24, 7j/7 » ou « lun–ven 9h–19h » (best effort). */
  function resume(texte) {
    var h = analyser(texte);
    if (!h) return (texte || '').trim() || 'Horaires non communiqués';
    if (h.permanent) return '24h/24, 7j/7';
    var lignes = [];
    h.semaine.forEach(function (plages, j) {
      var cle = plages.map(function (p) { return hhmm(p[0]) + '–' + hhmm(p[1]); }).join(', ');
      var derniere = lignes[lignes.length - 1];
      if (derniere && derniere.cle === cle) derniere.fin = j;
      else lignes.push({ debut: j, fin: j, cle: cle });
    });
    return lignes.map(function (l) {
      var jours = l.debut === l.fin ? JOURS_FR[l.debut]
        : JOURS_FR[l.debut].slice(0, 3) + '–' + JOURS_FR[l.fin].slice(0, 3);
      return jours + ' ' + (l.cle || 'fermé');
    }).join(' · ');
  }

  global.Bornes = global.Bornes || {};
  global.Bornes.horaires = { analyser: analyser, etat: etat, resume: resume };
})(window);
