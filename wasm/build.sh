#!/usr/bin/env bash
# Recompile demoparser2 en WebAssembly avec notre patch local, puis copie le résultat dans src/parser/wasm/.
#
# Prérequis : rustup target add wasm32-unknown-unknown ; cargo install wasm-pack
# Le patch :
#  - remplace std::time::Instant (indisponible en wasm32) par web_time::Instant ;
#  - active parse_projectiles dans parseGrenades (sinon aucune position de grenade) ;
#  - ajoute une sortie en colonnes (struct_of_arrays) à parseGrenades ;
#  - neutralise build.rs de csgoproto (les protobufs générés sont déjà versionnés upstream) ;
#  - ajoute parseVoice : paquets de voix (Opus) en colonnes, pour la lecture des comms.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
COMMIT="$(cat "$HERE/DEMOPARSER_COMMIT")"
WORK="${WORK:-$(mktemp -d)}"

git clone https://github.com/LaihoE/demoparser "$WORK/demoparser"
cd "$WORK/demoparser"
git checkout "$COMMIT"
git apply "$HERE/patches/demoparser2-wasm.patch"
cd src/wasm
wasm-pack build --release --target web --out-dir "$WORK/pkg"

DEST="$HERE/../src/parser/wasm"
cp "$WORK/pkg/demoparser2.js" "$WORK/pkg/demoparser2.d.ts" "$WORK/pkg/demoparser2_bg.wasm" "$DEST/"
cp "$WORK/demoparser/LICENSE" "$DEST/LICENSE-demoparser2"
echo "WASM mis à jour depuis demoparser@$COMMIT"
