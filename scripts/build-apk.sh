#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────
#  SHAI · Android APK builder
# ─────────────────────────────────────────────────────────────────
#  Usage:
#     bash scripts/build-apk.sh debug          # → build/SHAI-debug.apk
#     bash scripts/build-apk.sh release        # → build/SHAI-release-unsigned.apk
#     bash scripts/build-apk.sh release signed # → build/SHAI-release.apk (needs env)
#     bash scripts/build-apk.sh ci             # non-interactive, no gradle daemon
#
#  Prerequisites:
#     • JDK 17+          (java -version)
#     • Android SDK      (ANDROID_HOME / ANDROID_SDK_ROOT)
#     • Node 20+
#
#  Signed release needs these env vars (all optional):
#     KEYSTORE_FILE, KEYSTORE_PASSWORD, KEY_ALIAS, KEY_PASSWORD
# ─────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

MODE="${1:-debug}"
SIGN="${2:-}"
OUT_DIR="$ROOT/build"
GRADLE="./gradlew"
GRADLE_FLAGS=(-p android --no-daemon)

if [[ "$MODE" == "ci" ]]; then
  MODE="debug"
  GRADLE_FLAGS+=(--console=plain -q)
fi

APP_ID="net.shai.app"

say()  { printf '\033[1;36m%s\033[0m %s\n' "▶" "$*"; }
good() { printf '\033[1;32m%s\033[0m %s\n' "✔" "$*"; }
bad()  { printf '\033[1;31m%s\033[0m %s\n' "✖" "$*" >&2; }

# ── 1 · Environment checks ───────────────────────────────────────
if ! command -v java >/dev/null 2>&1; then
  bad "JDK not found. Install JDK 17+ and re-run."
  exit 1
fi

JAVA_MAJOR="$(java -version 2>&1 | sed -E 's/.*version "([0-9]+).*/\1/' | head -1)"
if [[ "${JAVA_MAJOR:-0}" =~ ^[0-9]+$ ]] && (( JAVA_MAJOR < 17 )); then
  bad "JDK $JAVA_MAJOR detected — JDK 17 or newer is required by Android Gradle Plugin 8.x."
  exit 1
fi

if [[ -z "${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}" ]]; then
  say "ANDROID_HOME is not set — Gradle will read local.properties / ~/Android/Sdk."
else
  say "Android SDK: ${ANDROID_HOME:-$ANDROID_SDK_ROOT}"
fi

# ── 2 · Web build ────────────────────────────────────────────────
say "Building the web bundle (Vite)…"
if [[ -f package-lock.json ]]; then
  npm ci --no-audit --no-fund
else
  npm install --no-audit --no-fund
fi
npm run build

# ── 3 · Copy web assets into the Android project ─────────────────
say "Syncing web assets into android/ …"
if ! npx --no-install cap sync android 2>/dev/null; then
  npx cap sync android
fi

# ── 4 · Gradle ───────────────────────────────────────────────────
chmod +x android/gradlew 2>/dev/null || true

mkdir -p "$OUT_DIR"

if [[ "$MODE" == "release" && "$SIGN" == "signed" ]]; then
  if [[ -z "${KEYSTORE_FILE:-}" || -z "${KEY_ALIAS:-}" ]]; then
    bad "Signed release requires KEYSTORE_FILE, KEYSTORE_PASSWORD, KEY_ALIAS and KEY_PASSWORD."
    exit 1
  fi
  say "Building SIGNED release APK…"
  "$GRADLE" "${GRADLE_FLAGS[@]}" assembleRelease \
    -Pandroid.injected.signing.store.file="$KEYSTORE_FILE" \
    -Pandroid.injected.signing.store.password="$KEYSTORE_PASSWORD" \
    -Pandroid.injected.signing.key.alias="$KEY_ALIAS" \
    -Pandroid.injected.signing.key.password="$KEY_PASSWORD"
  APK="$(find android/app/build/outputs/apk/release -name '*.apk' ! -name '*unsigned*' | head -1)"
  DEST="$OUT_DIR/SHAI-release.apk"
elif [[ "$MODE" == "release" ]]; then
  say "Building UNSIGNED release APK…"
  "$GRADLE" "${GRADLE_FLAGS[@]}" assembleRelease
  APK="$(find android/app/build/outputs/apk/release -name '*.apk' | head -1)"
  DEST="$OUT_DIR/SHAI-release-unsigned.apk"
else
  say "Building debug APK…"
  "$GRADLE" "${GRADLE_FLAGS[@]}" assembleDebug
  APK="$(find android/app/build/outputs/apk/debug -name '*.apk' | head -1)"
  DEST="$OUT_DIR/SHAI-debug.apk"
fi

if [[ -z "${APK:-}" || ! -f "$APK" ]]; then
  bad "Gradle finished but no APK was produced."
  exit 1
fi

cp "$APK" "$DEST"
good "APK ready → ${DEST#$ROOT/}  ($(du -h "$DEST" | cut -f1))"
good "Install on a device:  adb install -r \"$DEST\""
say "App id: $APP_ID"
