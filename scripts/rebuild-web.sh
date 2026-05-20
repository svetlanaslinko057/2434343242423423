#!/bin/bash
# Rebuild ATLAS DevOS web platform (admin + client surfaces).
#
# Because /app is a small 10GB volume and web's node_modules + build artefacts
# don't fit alongside the Expo bundle, we build in /tmp (overlay FS, ~90GB
# free) and copy only build/ back into /app/web/build, which FastAPI serves
# under /api/web-ui/.
#
# Usage:
#   bash /app/scripts/rebuild-web.sh
#
# Notes:
#   - /app/packages contains the shared design-system + runtime-client packages.
#     web/src/index.css imports them via `../../packages/design-system/...`.
#     We symlink /tmp/packages -> /app/packages so those relative paths resolve.
#   - We pin @react-native-async-storage/async-storage@1.23.1 in the web tree
#     because runtime-client/adapters/expo.ts has a static `require(...)` that
#     webpack5 has to resolve (lazy try/catch isn't enough). 1.23.1 ships a
#     browser-compatible CJS build; 3.x is ESM-only and breaks CRA's webpack.
set -euo pipefail

WORK=/tmp/webwork
SRC=/app/web
DEST=/app/web/build

rm -rf "$WORK"
mkdir -p "$WORK"
rsync -a --exclude=node_modules --exclude=build "$SRC/" "$WORK/"

# Symlink for packages relative path
ln -sfn /app/packages /tmp/packages

cd "$WORK"
yarn install --prefer-offline --network-timeout 600000
yarn add @react-native-async-storage/async-storage@1.23.1

CI=true NODE_OPTIONS="--max-old-space-size=4096" DISABLE_ESLINT_PLUGIN=true yarn build

rm -rf "$DEST"
mkdir -p "$DEST"
rsync -a "$WORK/build/" "$DEST/"

# Cleanup heavy intermediates so /app doesn't get polluted
rm -rf "$WORK" /tmp/packages

echo "Web rebuilt → $DEST"
echo "Served at: https://<host>/api/web-ui/"
