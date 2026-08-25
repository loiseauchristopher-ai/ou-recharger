# -*- coding: utf-8 -*-
"""Normalisation des reseaux de recharge IRVE.

Le jeu consolide data.gouv laisse chaque amenageur ecrire son enseigne comme il
veut : « LIDL », « Lidl France », « TESLA SUPERCHARGER », « Freshmile | FR*FR1 »...
On ramene tout ca a un reseau canonique pour que le filtre par marque soit utile.
"""
import re
import unicodedata

# Regles ordonnees : premier motif qui matche gagne. Les motifs sont testes sur
# la concatenation « enseigne + operateur + amenageur » deja normalisee.
REGLES = [
    (r"tesla", "Tesla"),
    (r"ionity", "Ionity"),
    (r"fastned", "Fastned"),
    (r"totalenergies|total marketing|total access", "TotalEnergies"),
    (r"electra", "Electra"),
    (r"engie vianeo|vianeo", "Engie Vianeo"),
    (r"power ?dot", "Power Dot"),
    (r"freshmile", "Freshmile"),
    (r"izivia|sodetrel", "Izivia"),
    (r"driveco", "Driveco"),
    (r"allego", "Allego"),
    (r"lidl", "Lidl"),
    (r"\bald\b|ayvens", "Ayvens"),
    (r"leclerc|scaleclerc|socamaine|sodilec", "E.Leclerc"),
    (r"carrefour", "Carrefour"),
    (r"intermarche|itm ", "Intermarché"),
    (r"super ?u|systeme ?u|hyper ?u|\bu express\b", "Super U"),
    (r"auchan", "Auchan"),
    (r"casino\b|geant casino", "Casino"),
    (r"lekiosk|ikea", "Ikea"),
    (r"decathlon", "Decathlon"),
    (r"mcdonald|mcdo", "McDonald's"),
    (r"burger king", "Burger King"),
    (r"indigo", "Indigo"),
    (r"\bqpark\b|q-?park", "Q-Park"),
    (r"effia", "Effia"),
    (r"saemes", "Saemes"),
    (r"belib", "Belib'"),
    (r"eborn", "eborn"),
    (r"reveo", "Révéo"),
    (r"modulo|mobive", "Mobive"),
    (r"sydev|sdeer|sde\b|siege\b|sdey|sdec|sieml|sdehg|syane|sydec|territoire d.energie|energie\d", "Réseau départemental"),
    (r"qovoltis", "Qovoltis"),
    (r"bump\b", "Bump"),
    (r"zeborne|ze-?borne", "ZEborne"),
    (r"easycharge", "EasyCharge"),
    (r"waat\b", "WAAT"),
    (r"greenflux", "GreenFlux"),
    (r"last ?mile|lmc\b", "Last Mile Solutions"),
    (r"bouygues", "Bouygues E&S"),
    (r"shell\b", "Shell Recharge"),
    (r"\bbp\b|aral\b", "BP Pulse"),
    (r"esso\b", "Esso"),
    (r"avia\b", "Avia"),
    (r"mobilygreen", "Mobilygreen"),
    (r"chargepoint", "ChargePoint"),
    (r"virta", "Virta"),
    (r"atlante", "Atlante"),
    (r"zunder", "Zunder"),
    (r"circle ?k", "Circle K"),
    (r"renault|mobilize|dacia", "Mobilize"),
    (r"stellantis|peugeot|citroen|\bds\b|opel|free2move", "Stellantis"),
    (r"\bbmw\b|mini\b", "BMW"),
    (r"mercedes|daimler", "Mercedes-Benz"),
    (r"volkswagen|audi\b|skoda|seat\b|cupra|elli\b", "Volkswagen Group"),
    (r"toyota|lexus", "Toyota"),
    (r"hyundai|kia\b", "Hyundai-Kia"),
    (r"nissan", "Nissan"),
    (r"ford\b", "Ford"),
    (r"volvo|polestar", "Volvo"),
    (r"porsche", "Porsche"),
    (r"accor|ibis|novotel|mercure", "Accor"),
    (r"campanile|louvre hotels|kyriad", "Louvre Hotels"),
    (r"b&b hotel", "B&B Hôtels"),
    (r"best western", "Best Western"),
    (r"huttopia|camping|yelloh", "Campings"),
    (r"vinci", "Vinci Autoroutes"),
    (r"apr[r]?\b|autoroute", "Autoroutes"),
    (r"leroy merlin", "Leroy Merlin"),
    (r"boulanger", "Boulanger"),
    (r"norauto", "Norauto"),
    (r"feu vert", "Feu Vert"),
    (r"mairie|commune de|ville de|departement|conseil|communaute", "Collectivité"),
]

_ACCENTS = re.compile(r"[̀-ͯ]")


def _clean(s):
    if not s:
        return ""
    s = unicodedata.normalize("NFD", str(s))
    s = _ACCENTS.sub("", s)
    s = s.lower()
    s = re.sub(r"[^a-z0-9&'\- ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _titre(s):
    """Remet une casse presentable sur une enseigne inconnue laissee telle quelle."""
    s = re.sub(r"\s+", " ", str(s or "").replace("\ufffd", "?")).strip(" |-")
    s = re.sub(r"\s*\|\s*FR\*?\w+$", "", s)  # « Freshmile | FR*FR1 »
    if not s:
        return ""
    if s.isupper() and len(s) > 4:
        return s.title()
    return s


def reseau(enseigne, operateur, amenageur):
    """Renvoie (reseau_canonique, source) pour une ligne IRVE."""
    sonde = " ".join(_clean(x) for x in (enseigne, operateur, amenageur))
    for motif, nom in REGLES:
        if re.search(motif, sonde):
            return nom
    for brut in (enseigne, operateur, amenageur):
        propre = _titre(brut)
        if propre and _clean(propre) not in ("null", "none", "n a", "na", "inconnu"):
            return propre
    return "Réseau non précisé"
