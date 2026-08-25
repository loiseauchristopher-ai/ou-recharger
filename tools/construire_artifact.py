# -*- coding: utf-8 -*-
"""Assemble l'application en un fichier HTML unique et autonome.

Utile pour la publier la ou seul un fichier peut etre servi (Artifact, partage
direct). Le style, les scripts et l'instantane des donnees sont incorpores ;
il ne reste aucune requete sortante obligatoire.

Usage : python3 tools/construire_artifact.py ../ou-recharger.html
"""
import os
import re
import sys

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SCRIPTS = [
    'donnees/fond-carte.js',
    'donnees/stations.js',
    'js/donnees.js',
    'js/horaires.js',
    'js/dispo.js',
    'js/carte.js',
    'js/app.js',
]


def lire(chemin):
    with open(os.path.join(RACINE, chemin), encoding='utf-8') as f:
        return f.read()


def main(dest):
    html = lire('index.html')

    # On ne garde que le contenu du <body> : l'hote fournit son propre squelette.
    corps = re.search(r'<body[^>]*>(.*)</body>', html, re.S).group(1)
    corps = re.sub(r'<script src="[^"]+"></script>\s*', '', corps)

    titre = re.search(r'<title>(.*?)</title>', html, re.S).group(1)
    polices = re.findall(r'<link rel="(?:preconnect|stylesheet)"[^>]*fonts\.[^>]*>', html)

    morceaux = ['<meta charset="utf-8">', '<title>' + titre + '</title>']
    morceaux += polices
    morceaux.append('<style>\n' + lire('style.css') + '\n</style>')
    morceaux.append(corps.strip())
    for chemin in SCRIPTS:
        morceaux.append('<script>\n/* ' + chemin + ' */\n' + lire(chemin) + '\n</script>')

    sortie = '\n'.join(morceaux) + '\n'
    with open(dest, 'w', encoding='utf-8') as f:
        f.write(sortie)
    print('%s : %.1f Mo' % (dest, len(sortie.encode('utf-8')) / 1e6))
    tete = sortie[:8192]
    print('titre dans les 8 premiers Ko :', '<title>' in tete)


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(RACINE, 'ou-recharger.html'))
