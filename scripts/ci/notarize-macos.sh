#!/usr/bin/env bash
# macOS Developer ID signing + notarytool (optional CI step).
# Gate in workflow: secrets.APPLE_DEVELOPER_ID_CERT_BASE64 != ''
set -euo pipefail

log() { printf '[notarize-macos] %s\n' "$*"; }
fail() { printf '[notarize-macos] ERROR: %s\n' "$*" >&2; exit 1; }

REQUIRE_SECRETS=0
SKIP_IF_NO_SECRETS=1
ARTIFACT_PATH=""
PACKAGE_DIR=""

usage() {
  cat <<'EOF'
Usage:
  notarize-macos.sh --package-dir <dir>     # codesign binaries under dir (if cert present)
  notarize-macos.sh --artifact <file.pkg>   # notarize + staple a .pkg
  --require-secrets                         # exit 1 if signing secrets missing
  --no-skip                                 # do not no-op when secrets missing
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --package-dir) PACKAGE_DIR="$2"; shift 2 ;;
    --artifact) ARTIFACT_PATH="$2"; shift 2 ;;
    --require-secrets) REQUIRE_SECRETS=1; shift ;;
    --no-skip) SKIP_IF_NO_SECRETS=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) fail "Unknown argument: $1" ;;
  esac
done

has_cert() {
  [[ -n "${APPLE_DEVELOPER_ID_CERT_BASE64:-}" && -n "${APPLE_DEVELOPER_ID_CERT_PASSWORD:-}" ]]
}

has_notary_api_key() {
  [[ -n "${APPLE_NOTARY_API_KEY_ID:-}" && -n "${APPLE_NOTARY_API_KEY_ISSUER_ID:-}" && -n "${APPLE_NOTARY_API_KEY_BASE64:-}" ]]
}

has_notary_apple_id() {
  [[ -n "${APPLE_ID:-}" && -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" && -n "${APPLE_TEAM_ID:-}" ]]
}

missing_secrets_msg() {
  cat <<'EOF'
Missing Apple signing/notarization secrets. Configure GitHub Actions secrets:
  APPLE_DEVELOPER_ID_CERT_BASE64, APPLE_DEVELOPER_ID_CERT_PASSWORD, APPLE_TEAM_ID
  and either App Store Connect API key (preferred):
    APPLE_NOTARY_API_KEY_ID, APPLE_NOTARY_API_KEY_ISSUER_ID, APPLE_NOTARY_API_KEY_BASE64
  or legacy:
    APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD
See docs/ops/windows-service-and-signing.md Phase C runbook.
EOF
}

if ! has_cert && ! has_notary_api_key && ! has_notary_apple_id; then
  if [[ "$REQUIRE_SECRETS" -eq 1 ]]; then
    missing_secrets_msg
    fail "Secrets required but not set."
  fi
  if [[ "$SKIP_IF_NO_SECRETS" -eq 1 ]]; then
    log "SKIP: $(missing_secrets_msg | tr '\n' ' ')"
    exit 0
  fi
  missing_secrets_msg
  fail "No secrets and --no-skip set."
fi

sign_package_dir() {
  local dir="$1"
  [[ -d "$dir" ]] || fail "Package dir not found: $dir"
  if ! has_cert; then
    log "No Developer ID certificate secrets; skipping codesign for $dir"
    return 0
  fi

  local p12="$RUNNER_TEMP/remote-agent-devid.p12"
  local keychain="$RUNNER_TEMP/remote-agent-signing.keychain-db"
  local keychain_pass="${APPLE_KEYCHAIN_PASSWORD:-remote-agent-ci}"

  echo "$APPLE_DEVELOPER_ID_CERT_BASE64" | base64 --decode >"$p12"
  security create-keychain -p "$keychain_pass" "$keychain"
  security set-keychain-settings -lut 21600 "$keychain"
  security unlock-keychain -p "$keychain_pass" "$keychain"
  security import "$p12" -k "$keychain" -P "$APPLE_DEVELOPER_ID_CERT_PASSWORD" -T /usr/bin/codesign -T /usr/bin/security
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$keychain_pass" "$keychain"
  security list-keychains -d user -s "$keychain"

  local identity="${APPLE_CODESIGN_IDENTITY:-}"
  if [[ -z "$identity" ]]; then
    identity=$(security find-identity -v -p codesigning "$keychain" | sed -n 's/.*"\(.*\)".*/\1/p' | head -n1)
  fi
  [[ -n "$identity" ]] || fail "Could not resolve codesign identity; set APPLE_CODESIGN_IDENTITY"

  local signed=0
  while IFS= read -r -d '' bin; do
    log "codesign: $bin"
    codesign --force --options runtime --sign "$identity" --timestamp "$bin"
    signed=$((signed + 1))
  done < <(find "$dir" -type f \( -name '*.dylib' -o -perm -111 \) ! -name '*.sh' ! -name '*.js' -print0 2>/dev/null || true)

  if [[ "$signed" -eq 0 ]]; then
    log "No native Mach-O binaries under $dir; codesign skipped (current tar.gz is Node scripts only)."
  fi

  rm -f "$p12"
}

notarize_artifact() {
  local artifact="$1"
  [[ -f "$artifact" ]] || fail "Artifact not found: $artifact"
  case "$artifact" in
    *.pkg) ;;
    *) log "Artifact is not .pkg ($artifact); notarization applies when macOS .pkg installer ships."; return 0 ;;
  esac

  if ! has_notary_api_key && ! has_notary_apple_id; then
    fail "Notarization secrets missing for $artifact"
  fi

  local submit_args=()
  if has_notary_api_key; then
    local p8="$RUNNER_TEMP/AuthKey.p8"
    echo "$APPLE_NOTARY_API_KEY_BASE64" | base64 --decode >"$p8"
    submit_args=(--key "$p8" --key-id "$APPLE_NOTARY_API_KEY_ID" --issuer "$APPLE_NOTARY_API_KEY_ISSUER_ID")
  else
    submit_args=(--apple-id "$APPLE_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD" --team-id "$APPLE_TEAM_ID")
  fi

  log "notarytool submit: $artifact"
  xcrun notarytool submit "$artifact" "${submit_args[@]}" --wait
  xcrun stapler staple "$artifact"
  log "Stapled ticket on $artifact"
}

RUNNER_TEMP="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"

if [[ -n "$PACKAGE_DIR" ]]; then
  sign_package_dir "$PACKAGE_DIR"
fi

if [[ -n "$ARTIFACT_PATH" ]]; then
  notarize_artifact "$ARTIFACT_PATH"
fi

if [[ -z "$PACKAGE_DIR" && -z "$ARTIFACT_PATH" ]]; then
  usage
  fail "Specify --package-dir and/or --artifact"
fi

log "Done."
