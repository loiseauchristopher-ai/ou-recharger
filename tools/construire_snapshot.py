# -*- coding: utf-8 -*-
"""Agrege le CSV IRVE consolide (data.gouv) en un instantane compact par station.

Le CSV source decrit un *point de charge* par ligne (224k lignes, 150 Mo). L'app
raisonne par *station* : on regroupe, on deduplique les points de charge repetes,
on somme les prises et on garde la puissance max.

Usage : python3 construire_snapshot.py irve.csv ../donnees/stations.js
"""
import csv
import json
import math
import re
import sys
import unicodedata
from collections import defaultdict

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from normalisation import reseau  # noqa: E402

csv.field_size_limit(10 ** 9)

VRAI = {"true", "True", "1", "oui", "OUI", "t", "TRUE"}
PRISES = [
    ("prise_type_ef", 1),          # domestique
    ("prise_type_2", 2),           # Type 2
    ("prise_type_combo_ccs", 4),   # CCS
    ("prise_type_chademo", 8),     # CHAdeMO
    ("prise_type_autre", 16),
]
IMPLANTATIONS = ["Voirie", "Parking public", "Parking privé à usage public",
                 "Parking privé réservé", "Station dédiée", "Autre"]


def bool_irve(v):
    return str(v).strip() in VRAI


def norm_implantation(v):
    v = (v or "").strip().lower()
    if not v:
        return 5
    if "voirie" in v:
        return 0
    if "priv" in v and "usage public" in v:
        return 2
    if "priv" in v or "reserv" in v or "réserv" in v:
        return 3
    if "parking" in v:
        return 1
    if "station" in v or "dedi" in v or "dédi" in v:
        return 4
    return 5


def horaires_247(h):
    return bool(re.match(r"^\s*24/7\s*$", h or "")) or \
        bool(re.match(r"^\s*mo-su\s*00:00-(23:5\d|24:00|00:00)\s*$", (h or "").lower()))


UUID = re.compile(
    r"[/\s_-]*\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b",
    re.I)
HEXA_LONG = re.compile(r"[/\s_-]+\b[0-9a-f]{16,}\b", re.I)
# « .../kuehne-nagel-saint-jory » : identifiant interne colle au nom commercial.
# Il nomme souvent le site : on le rend lisible plutot que de le jeter.
SLUG = re.compile(r"/\s*([a-z0-9]+(?:[-_][a-z0-9]+){1,})\s*$")


def nom_station(brut, maxlen=70):
    """Retire les identifiants techniques accoles au nom.

    Plusieurs operateurs publient « Charge Unix/50444d1a-ac94-... » : l'UUID est
    du bruit pour qui cherche une borne.
    """
    s = UUID.sub("", brut or "")
    s = HEXA_LONG.sub("", s)
    s = SLUG.sub(lambda m: " — " + m.group(1).replace("_", "-").replace("-", " ").title(), s)
    return nettoie(s, maxlen)


def nettoie(s, maxlen=70):
    # Quelques lignes du fichier consolide arrivent deja abimees (encodage perdu
    # chez l'operateur : « ESPLANADE DES F\ufffdTES »). Le caractere d'origine est
    # irrecuperable : on le marque plutot que de deviner une lettre.
    s = (s or "").replace("\ufffd", "?")
    s = re.sub(r"\s+", " ", s.strip())
    s = s.strip(" ,;-|")
    if len(s) > maxlen:
        s = s[:maxlen - 1].rstrip() + "…"
    return s


def sans_accent(s):
    return "".join(c for c in unicodedata.normalize("NFD", s or "")
                   if unicodedata.category(c) != "Mn").lower()


def cle_station(row):
    ident = (row.get("id_station_itinerance") or "").strip()
    if ident and ident.lower() not in ("null", "none", "non concerné", "non concerne"):
        return "i:" + ident.upper()
    ident = (row.get("id_station_local") or "").strip()
    lat = row.get("consolidated_latitude") or ""
    lon = row.get("consolidated_longitude") or ""
    if ident:
        return "l:%s@%s" % (ident, lat[:8])
    return "g:%s|%s|%s" % (nettoie(row.get("nom_station")), lat[:8], lon[:8])


RAYON_FUSION_M = 25


def fusionner_doublons(stations):
    """Fusionne les stations publiees deux fois par deux sources differentes.

    Le fichier consolide agrege plusieurs producteurs (l'operateur lui-meme,
    eco-movement, qualicharge...). Une meme station physique y apparait alors
    plusieurs fois sous des identifiants d'itinerance differents — par exemple
    l'Electra de l'Intermarche La Cepiere a Toulouse, publie a la fois sous
    FRELCPTOUCAC et FRELCP12954111, aux memes coordonnees.

    Deux stations du meme reseau distantes de moins de 25 m sont considerees
    comme une seule. Le nombre de points de charge retenu est le maximum et non
    la somme : ce sont les memes bornes decrites deux fois.
    """
    pas = 0.0005                                  # ~55 m en latitude
    grille = {}
    fusionnees = {}
    absorbees = 0

    for cle, st in stations.items():
        ci, cj = int(st["lat"] / pas), int(st["lon"] / pas)
        jumelle = None
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                for cle_voisine in grille.get((ci + di, cj + dj), ()):
                    voisine = fusionnees[cle_voisine]
                    if voisine["res"] != st["res"]:
                        continue
                    if distance_m(voisine["lat"], voisine["lon"], st["lat"], st["lon"]) <= RAYON_FUSION_M:
                        jumelle = voisine
                        break
                if jumelle:
                    break
            if jumelle:
                break

        if jumelle is None:
            fusionnees[cle] = st
            grille.setdefault((ci, cj), []).append(cle)
            continue

        absorbees += 1
        jumelle["pmax"] = max(jumelle["pmax"], st["pmax"])
        jumelle["prises"] |= st["prises"]
        jumelle["pdc"] = jumelle["pdc"] if len(jumelle["pdc"]) >= len(st["pdc"]) else st["pdc"]
        jumelle["nbre_pdc"] = max(jumelle["nbre_pdc"], st["nbre_pdc"])
        for drapeau in ("gratuit", "cb", "acte", "pmr", "resa", "2roues", "libre"):
            jumelle[drapeau] |= st[drapeau]
        if st.get("h247"):
            jumelle["h247"] = True
        if st["maj"] > jumelle["maj"]:
            jumelle["maj"] = st["maj"]
            if st["h"]:
                jumelle["h"] = st["h"]
        # On garde l'adresse et le nom les plus renseignes.
        if len(st["adr"]) > len(jumelle["adr"]):
            jumelle["adr"] = st["adr"]
        if not jumelle["nom"] or (st["nom"] and len(st["nom"]) < len(jumelle["nom"])):
            jumelle["nom"] = st["nom"] or jumelle["nom"]
        if not jumelle["ville"]:
            jumelle["ville"], jumelle["cp"] = st["ville"], st["cp"]

    print("doublons inter-sources fusionnes :", absorbees)
    return fusionnees


def distance_m(lat1, lon1, lat2, lon2):
    """Distance approchee, suffisante a l'echelle de quelques dizaines de metres."""
    dlat = (lat2 - lat1) * 111320.0
    dlon = (lon2 - lon1) * 111320.0 * math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot(dlat, dlon)


def main(src, dest):
    stations = {}
    lus = 0
    for row in csv.DictReader(open(src, newline="", encoding="utf-8")):
        lus += 1
        try:
            lat = float(row["consolidated_latitude"])
            lon = float(row["consolidated_longitude"])
        except (TypeError, ValueError):
            continue
        if not (-62 < lon < 56 and -22 < lat < 52):   # France + DROM
            continue

        cle = cle_station(row)
        st = stations.get(cle)
        if st is None:
            st = stations[cle] = {
                "lat": lat, "lon": lon,
                "nom": nom_station(row.get("nom_station")),
                "adr": nettoie(row.get("adresse_station"), 90),
                "cp": (row.get("consolidated_code_postal") or "").strip()[:5],
                "ville": nettoie(row.get("consolidated_commune"), 40),
                "res": reseau(row.get("nom_enseigne"), row.get("nom_operateur"),
                              row.get("nom_amenageur")),
                "ope": nettoie(row.get("nom_operateur"), 40),
                "pmax": 0.0, "prises": 0, "impl": norm_implantation(row.get("implantation_station")),
                "pdc": set(), "nbre_pdc": 0, "maj": (row.get("date_maj") or "")[:10],
                "h": nettoie(row.get("horaires"), 120), "tarif": nettoie(row.get("tarification"), 90),
                "tel": nettoie(row.get("telephone_operateur"), 24),
                "gratuit": False, "cb": False, "acte": False, "pmr": False,
                "resa": False, "2roues": False, "libre": False,
            }
        try:
            p = float(row.get("puissance_nominale") or 0)
            if p > 1000:      # quelques flux declarent des watts
                p = p / 1000.0
            if 0 < p < 1000:
                st["pmax"] = max(st["pmax"], p)
        except ValueError:
            pass
        for champ, bit in PRISES:
            if bool_irve(row.get(champ)):
                st["prises"] |= bit
        ident_pdc = (row.get("id_pdc_itinerance") or row.get("id_pdc_local") or "").strip()
        if ident_pdc:
            st["pdc"].add(ident_pdc)
        try:
            st["nbre_pdc"] = max(st["nbre_pdc"], int(float(row.get("nbre_pdc") or 0)))
        except ValueError:
            pass
        st["gratuit"] |= bool_irve(row.get("gratuit"))
        st["cb"] |= bool_irve(row.get("paiement_cb"))
        st["acte"] |= bool_irve(row.get("paiement_acte"))
        st["resa"] |= bool_irve(row.get("reservation"))
        st["2roues"] |= bool_irve(row.get("station_deux_roues"))
        acc = sans_accent(row.get("accessibilite_pmr"))
        if "accessible" in acc and "non accessible" not in acc:
            st["pmr"] = True
        cond = sans_accent(row.get("condition_acces"))
        if "libre" in cond:
            st["libre"] = True
        if horaires_247(row.get("horaires")):
            st["h247"] = True

    stations = fusionner_doublons(stations)

    # ---- serialisation compacte : dictionnaires + colonnes paralleles -------
    reseaux, horaires, villes, cps, majs = [], [], [], [], []
    idx_res, idx_hor, idx_ville, idx_cp, idx_maj = {}, {}, {}, {}, {}

    def idx(val, table, cache):
        if val not in cache:
            cache[val] = len(table)
            table.append(val)
        return cache[val]

    cols = defaultdict(list)
    for st in stations.values():
        # Le champ nbre_pdc est declaratif et parfois faux (une station Bump du
        # 4e arrondissement annonce 229 points pour 21 reellement identifies).
        # On compte donc les identifiants de points de charge distincts, et on
        # ne retombe sur la valeur declaree que faute d'identifiant.
        nb = len(st["pdc"]) or max(st["nbre_pdc"], 1)
        drapeaux = (
            (1 if st["gratuit"] else 0) | (2 if st["cb"] else 0) |
            (4 if st.get("h247") else 0) | (8 if st["pmr"] else 0) |
            (16 if st["resa"] else 0) | (32 if st["2roues"] else 0) |
            (64 if st["libre"] else 0) | (128 if st["acte"] else 0)
        )
        cols["lat"].append(round(st["lat"] * 1e5))
        cols["lon"].append(round(st["lon"] * 1e5))
        cols["p"].append(round(st["pmax"] * 10))
        cols["n"].append(min(nb, 65535))
        cols["r"].append(idx(st["res"], reseaux, idx_res))
        cols["c"].append(st["prises"])
        cols["f"].append(drapeaux)
        cols["i"].append(st["impl"])
        cols["h"].append(idx(st["h"], horaires, idx_hor))
        # l'adresse repete presque toujours « 75008 Paris » a la fin : on l'enleve,
        # l'app la reconstruit depuis les colonnes cp/ville.
        adr = re.sub(r"[,\s]*\b%s\b.*$" % re.escape(st["cp"]), "", st["adr"]) if st["cp"] else st["adr"]
        adr = adr.strip(" ,;-")
        nom = "" if (st["nom"] and (st["nom"] == adr or st["nom"] == st["adr"])) else st["nom"]
        cols["nom"].append(nom)
        cols["adr"].append(adr)
        cols["cp"].append(idx(st["cp"], cps, idx_cp))
        cols["ville"].append(idx(st["ville"], villes, idx_ville))
        cols["maj"].append(idx(st["maj"], majs, idx_maj))

    paquet = {
        "genere_le": None,           # rempli par l'appelant (pas de date en dur ici)
        "source": "Fichier consolidé IRVE — data.gouv.fr / Etalab (Licence Ouverte)",
        "nb_stations": len(stations),
        "nb_points": sum(cols["n"]),
        "reseaux": reseaux,
        "horaires": horaires,
        "villes": villes,
        "cps": cps,
        "majs": majs,
        "implantations": IMPLANTATIONS,
        "colonnes": {k: cols[k] for k in cols},
    }
    with open(dest, "w", encoding="utf-8") as f:
        json.dump(paquet, f, ensure_ascii=False, separators=(",", ":"))
    print("lignes lues %d -> %d stations, %d points de charge"
          % (lus, len(stations), sum(cols["n"])))
    print("reseaux distincts :", len(reseaux))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
