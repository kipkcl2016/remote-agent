#!/bin/bash
set -euo pipefail

project_dir="$(cd "$(dirname "$0")/.." && pwd)"
destination="${IOS_SIMULATOR_DESTINATION:-platform=iOS Simulator,name=iPhone 17 Pro,OS=latest}"
derived_data="${IOS_E2E_DERIVED_DATA:-/tmp/remote-agent-ios-e2e}"
cd "$project_dir"
node tests/native-gateway-fixture.mjs > /tmp/remote-agent-native-gateway-fixture.log 2>&1 &
fixture_pid=$!
trap 'kill "$fixture_pid" 2>/dev/null || true' EXIT INT TERM

for _ in $(seq 1 50); do
  if nc -z 127.0.0.1 17831 && nc -z 127.0.0.1 17832; then
    break
  fi
  sleep 0.1
done

nc -z 127.0.0.1 17831
nc -z 127.0.0.1 17832

xcodebuild test \
  -project ios/App/App.xcodeproj \
  -scheme App \
  -destination "$destination" \
  -derivedDataPath "$derived_data" \
  "$@"
