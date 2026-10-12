#!/usr/bin/env bash
# Downloads the open data sources used by scripts/build_lemmas.py into scripts/.cache (git-ignored).
# Prints sizes only, never contents.
set -euo pipefail
cd "$(dirname "$0")"
CACHE=.cache
mkdir -p "$CACHE/cefr" "$CACHE/blocklist"
[ -x "$CACHE/venv/bin/python" ] || python3 -m venv "$CACHE/venv"
"$CACHE/venv/bin/pip" install -q wordfreq nltk
NLTK_ALLOW_PROXIED_URLOPEN=1 "$CACHE/venv/bin/python" -c "
import nltk
for p in ['wordnet', 'omw-1.4', 'averaged_perceptron_tagger_eng', 'words']:
    nltk.download(p, download_dir='$CACHE/nltk_data', quiet=True)
"
OLP=https://raw.githubusercontent.com/openlanguageprofiles/olp-en-cefrj/master
curl -sSfL -o "$CACHE/cefr/cefrj-vocabulary-profile-1.5.csv" "$OLP/cefrj-vocabulary-profile-1.5.csv"
curl -sSfL -o "$CACHE/cefr/octanove-vocabulary-profile-c1c2-1.0.csv" "$OLP/octanove-vocabulary-profile-c1c2-1.0.csv"
curl -sSfL -o "$CACHE/blocklist/en.txt" \
  https://raw.githubusercontent.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words/master/en
du -sh "$CACHE/nltk_data" "$CACHE/cefr" "$CACHE/blocklist"
