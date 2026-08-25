/* Modeles electriques courants en France.
 *
 * Trois valeurs par modele :
 *   batterie  — capacite *utile* en kWh (celle qu'on peut reellement consommer,
 *               inferieure a la capacite brute annoncee) ;
 *   conso     — consommation en kWh/100 km sur un trajet mixte a allure
 *               soutenue, plus proche du reel que le cycle WLTP ;
 *   charge    — puissance de charge rapide en courant continu, en kW.
 *
 * Ce sont des ORDRES DE GRANDEUR, pas des donnees constructeur : la
 * consommation reelle depend de la vitesse, du relief, du chargement et surtout
 * de la temperature (compter 20 a 30 % de plus en hiver). L'interface laisse
 * corriger la consommation, et le calcul d'etapes garde une reserve.
 */
(function (global) {
  'use strict';

  var MODELES = [
    // marque, modele, batterie kWh utile, conso kWh/100km, charge DC kW
    ['Renault', 'Zoe R135 (52 kWh)', 52, 17.5, 46],
    ['Renault', 'Megane E-Tech EV60', 60, 17, 130],
    ['Renault', 'Scenic E-Tech 87 kWh', 87, 18, 150],
    ['Renault', '5 E-Tech (52 kWh)', 52, 15.5, 100],
    ['Renault', '5 E-Tech (40 kWh)', 40, 15, 80],
    ['Renault', 'Twingo E-Tech', 22, 16, 22],
    ['Peugeot', 'e-208 (51 kWh)', 51, 15.5, 100],
    ['Peugeot', 'e-2008 (54 kWh)', 54, 17, 100],
    ['Peugeot', 'e-308', 54, 16, 120],
    ['Peugeot', 'e-3008 (73 kWh)', 73, 17.5, 160],
    ['Peugeot', 'e-5008 (73 kWh)', 73, 18.5, 160],
    ['Citroën', 'ë-C4 (50 kWh)', 50, 17, 100],
    ['Citroën', 'ë-C3 (44 kWh)', 44, 16, 100],
    ['Citroën', 'ë-Berlingo', 50, 19.5, 100],
    ['Tesla', 'Model 3 Propulsion', 57.5, 15, 170],
    ['Tesla', 'Model 3 Grande Autonomie', 75, 16, 250],
    ['Tesla', 'Model Y Propulsion', 57.5, 16, 170],
    ['Tesla', 'Model Y Grande Autonomie', 75, 17, 250],
    ['Tesla', 'Model S', 95, 19, 250],
    ['Volkswagen', 'ID.3 Pro (58 kWh)', 58, 16.5, 120],
    ['Volkswagen', 'ID.4 Pro (77 kWh)', 77, 18.5, 135],
    ['Volkswagen', 'ID.7 Pro (77 kWh)', 77, 16.5, 175],
    ['Volkswagen', 'e-up!', 32, 14, 40],
    ['Skoda', 'Enyaq 60', 58, 17.5, 125],
    ['Skoda', 'Enyaq 85', 77, 18, 135],
    ['Skoda', 'Elroq 85', 77, 17, 135],
    ['Cupra', 'Born (58 kWh)', 58, 16.5, 120],
    ['Audi', 'Q4 e-tron 45', 77, 18.5, 135],
    ['Audi', 'e-tron GT', 85, 20, 270],
    ['BMW', 'i4 eDrive40', 81, 17.5, 205],
    ['BMW', 'iX1 xDrive30', 65, 17.5, 130],
    ['BMW', 'iX3', 74, 18, 150],
    ['Mercedes-Benz', 'EQA 250', 66, 17.5, 100],
    ['Mercedes-Benz', 'EQB 250', 66, 18.5, 100],
    ['Mercedes-Benz', 'EQE 350', 90, 18, 170],
    ['Hyundai', 'Kona 65 kWh', 64, 15.5, 77],
    ['Hyundai', 'Ioniq 5 (77 kWh)', 77, 18, 220],
    ['Hyundai', 'Ioniq 6 (77 kWh)', 77, 15.5, 230],
    ['Kia', 'e-Niro 64 kWh', 64, 16, 77],
    ['Kia', 'EV6 (77 kWh)', 77, 17.5, 240],
    ['Kia', 'EV3 (81 kWh)', 81, 15.5, 130],
    ['Nissan', 'Leaf 40 kWh', 39, 17, 46],
    ['Nissan', 'Leaf 62 kWh', 59, 18, 46],
    ['Nissan', 'Ariya 87 kWh', 87, 18.5, 130],
    ['Fiat', '500e (42 kWh)', 37.3, 15, 85],
    ['Fiat', 'Grande Panda', 44, 16, 100],
    ['Dacia', 'Spring', 26.8, 14.5, 30],
    ['MG', 'MG4 64 kWh', 61, 16.5, 140],
    ['MG', 'ZS EV', 68, 18, 92],
    ['Volvo', 'EX30', 64, 16, 153],
    ['Volvo', 'XC40 Recharge', 78, 19, 150],
    ['Polestar', '2 Long Range', 78, 17.5, 205],
    ['Ford', 'Mustang Mach-E ER', 91, 19, 150],
    ['Ford', 'Explorer EV', 77, 17.5, 135],
    ['Opel', 'Corsa-e (51 kWh)', 51, 16.5, 100],
    ['Opel', 'Mokka-e (54 kWh)', 54, 17, 100],
    ['Toyota', 'bZ4X', 64, 17.5, 150],
    ['Porsche', 'Taycan', 83.7, 20, 270],
    ['Smart', '#1', 62, 17.5, 150],
    ['BYD', 'Atto 3', 60, 17.5, 88],
    ['BYD', 'Dolphin', 60, 16, 88],
    ['BYD', 'Seal', 82, 16.5, 150],
    ['Jeep', 'Avenger Electric', 51, 16, 100],
    ['Mini', 'Cooper SE', 28.9, 15.5, 50]
  ];

  function liste() {
    return MODELES.map(function (m, i) {
      return {
        id: i, marque: m[0], modele: m[1],
        batterie: m[2], conso: m[3], charge: m[4],
        libelle: m[0] + ' ' + m[1]
      };
    });
  }

  global.Bornes = global.Bornes || {};
  global.Bornes.vehicules = { liste: liste };
})(window);
