#!/usr/bin/env bash
set -e

echo "Node: $(node -v)"
echo "NPM:  $(npm -v)"

# Ensure deps are present (works for both fresh and cached builds)
if [ -f package-lock.json ]; then
  npm ci || npm install
else
  npm install
fi

# 🔧 Run CRA build by invoking the JS directly (avoids exec permission issues)
node ./node_modules/react-scripts/bin/react-scripts.js build
