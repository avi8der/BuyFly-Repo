#!/usr/bin/env bash
set -euo pipefail

echo "Installing deps…"
npm install

echo "Building React (CRA) with Node…"
# CI=false avoids “treating warnings as errors” in CI
CI=false node node_modules/react-scripts/scripts/build.js