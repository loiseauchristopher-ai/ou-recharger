/* Saisie vocale d'une adresse.
 *
 * L'API de reconnaissance vocale du navigateur (webkitSpeechRecognition) est
 * disponible dans Safari depuis iOS 14.5 et dans Chrome, mais pas partout : le
 * bouton n'apparait que la ou elle repond, et le clavier du telephone garde de
 * toute facon sa propre dictee.
 *
 * Rien n'est enregistre ni envoye par l'application : la reconnaissance est
 * celle du systeme, et seul le texte reconnu revient dans le champ.
 */
(function (global) {
  'use strict';

  var Moteur = global.SpeechRecognition || global.webkitSpeechRecognition;

  function disponible() { return !!Moteur; }

  /* Dicte une fois, puis rend la main. Les rappels : surTexte(mots),
   * surEtat('ecoute' | 'fini'), surErreur(message). */
  function ecouter(rappels) {
    if (!Moteur) return null;
    var reconnaissance = new Moteur();
    reconnaissance.lang = 'fr-FR';
    reconnaissance.interimResults = true;      // on montre la phrase en cours
    reconnaissance.maxAlternatives = 1;
    reconnaissance.continuous = false;

    reconnaissance.onstart = function () {
      if (rappels.surEtat) rappels.surEtat('ecoute');
    };
    reconnaissance.onresult = function (ev) {
      var texte = '';
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        texte += ev.results[i][0].transcript;
      }
      var definitif = ev.results[ev.results.length - 1].isFinal;
      if (rappels.surTexte) rappels.surTexte(nettoyer(texte), definitif);
    };
    reconnaissance.onerror = function (ev) {
      if (rappels.surErreur) rappels.surErreur(messageErreur(ev.error));
    };
    reconnaissance.onend = function () {
      if (rappels.surEtat) rappels.surEtat('fini');
    };

    try { reconnaissance.start(); } catch (e) {
      if (rappels.surErreur) rappels.surErreur('la dictée n’a pas pu démarrer');
      return null;
    }
    return reconnaissance;
  }

  /* La dictee ecrit les nombres en toutes lettres ; une adresse a besoin de
   * chiffres pour etre retrouvee. On ne convertit que le nombre en tete — le
   * numero de rue — car « rue des Quatre Vents » doit rester tel quel. */
  var UNITES = {
    'zero': 0, 'un': 1, 'une': 1, 'deux': 2, 'trois': 3, 'quatre': 4, 'cinq': 5,
    'six': 6, 'sept': 7, 'huit': 8, 'neuf': 9, 'dix': 10, 'onze': 11,
    'douze': 12, 'treize': 13, 'quatorze': 14, 'quinze': 15, 'seize': 16
  };
  var DIZAINES = {
    'vingt': 20, 'vingts': 20, 'trente': 30, 'quarante': 40,
    'cinquante': 50, 'soixante': 60
  };

  function motNu(mot) {
    return mot.toLowerCase().replace(/[.,;:]/g, '').replace(/-/g, ' ');
  }

  /* Les formes composees se lisent mal mot a mot. On produit une liste de
   * jetons portant chacun le nombre de mots d'origine qu'il consomme, ce qui
   * evite d'avoir a le recalculer ensuite. */
  function jetons(mots) {
    var out = [];
    for (var i = 0; i < mots.length; i++) {
      var a = motNu(mots[i]), b = motNu(mots[i + 1] || ''), c = motNu(mots[i + 2] || '');

      /* « quatre-vingt-dix » vaut 90, « quatre-vingts » 80 — mais « quatre » seul
       * en vaut 4, et « quatre vingt trois » fait 83 (80 puis 3). */
      if (a === 'quatre' && (b === 'vingt' || b === 'vingts')) {
        if (c === 'dix') { out.push({ valeur: 90, mots: 3 }); i += 2; }
        else { out.push({ valeur: 80, mots: 2 }); i += 1; }
        continue;
      }
      /* « soixante-dix » vaut 70 ; « soixante-quinze » est 60 + 15, pas 70 + 15. */
      if (a === 'soixante' && b === 'dix') {
        out.push({ valeur: 70, mots: 2 });
        i += 1;
        continue;
      }
      if (DIZAINES[a] !== undefined) { out.push({ valeur: DIZAINES[a], mots: 1 }); continue; }
      if (UNITES[a] !== undefined) { out.push({ valeur: UNITES[a], mots: 1 }); continue; }
      if (a === 'cent' || a === 'cents') { out.push({ cent: true, mots: 1 }); continue; }
      if (a === 'mille') { out.push({ mille: true, mots: 1 }); continue; }
      if (a === 'et') { out.push({ liaison: true, mots: 1 }); continue; }
      out.push({ fin: true, mots: 1 });
    }
    return out;
  }

  /* Consomme le nombre en tete et renvoie { valeur, restant }, ou null. */
  function nombreEnTete(mots) {
    var liste = jetons(mots);
    var total = 0, courant = 0, consommes = 0, vuUnChiffre = false;

    for (var i = 0; i < liste.length; i++) {
      var j = liste[i];
      if (j.fin) break;
      if (j.liaison) {
        if (!vuUnChiffre) break;
        consommes += j.mots;
        continue;
      }
      if (j.cent) { courant = (courant || 1) * 100; }
      else if (j.mille) { total += (courant || 1) * 1000; courant = 0; }
      else { courant += j.valeur; }
      vuUnChiffre = true;
      consommes += j.mots;
    }
    if (!vuUnChiffre) return null;
    return { valeur: total + courant, restant: mots.slice(consommes) };
  }

  function nettoyer(texte) {
    var mots = texte.trim().split(/\s+/).filter(Boolean);
    if (!mots.length) return '';
    var tete = nombreEnTete(mots);
    if (!tete || tete.valeur === 0) return mots.join(' ');
    return [String(tete.valeur)].concat(tete.restant).join(' ');
  }

  function messageErreur(code) {
    if (code === 'not-allowed' || code === 'service-not-allowed') {
      return 'microphone refusé — autorisez-le dans les réglages du navigateur';
    }
    if (code === 'no-speech') return 'rien n’a été entendu';
    if (code === 'network') return 'la reconnaissance vocale n’a pas pu joindre le service';
    return 'dictée interrompue';
  }

  global.Bornes = global.Bornes || {};
  global.Bornes.dictee = { disponible: disponible, ecouter: ecouter, nettoyer: nettoyer };
})(window);
