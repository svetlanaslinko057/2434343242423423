#!/usr/bin/env bash
# scan_tokens.sh — Phase 1 token governance.
#
# Verifies:
#   1. /app/packages/design-system/tokens/palette.{js,css} are in sync.
#   2. /app/frontend/src/design-system/palette.js mirrors the canonical.
#   3. Reports raw #hex literals in page-level code (warning, not failure
#      yet — Phase 3 will make this a hard CI failure once codemod is run).
#
# Exit codes:
#   0 = clean
#   1 = sync violation (CI MUST fail)
#   2 = raw-hex warnings present (info only for Phase 1)
set -u

DS_JS=/app/packages/design-system/tokens/palette.js
DS_CSS=/app/packages/design-system/tokens/palette.css
DS_MOBILE=/app/frontend/src/design-system/palette.js
FAIL=0
WARN=0

echo "═══ Token Sync Audit ═══"

# 1. Mobile mirror must match canonical 1:1.
if ! diff -q "$DS_JS" "$DS_MOBILE" >/dev/null 2>&1; then
  echo "❌ FAIL: mobile mirror drifted"
  echo "        canonical: $DS_JS"
  echo "        mobile:    $DS_MOBILE"
  echo "        run: cp $DS_JS $DS_MOBILE"
  FAIL=1
else
  echo "✅ mobile mirror matches canonical"
fi

# 2. Spot-check key hex values are present in CSS file (cross-check JS/CSS).
KEYS=(
  "#0F0F11"  "#16161A"  "#1E1E22"  "#0A0A0C"   # dark substrate
  "#EBEAE5"  "#9C9B95"  "#73716C"               # dark text
  "#8C9B90"  "#7E9684"  "#C9A961"  "#B86A6A"  "#788491"  # dark signal+status
  "#FAF8F4"  "#FFFFFF"  "#F1EEE7"  "#E9E4DA"   # light substrate
  "#1A1714"  "#5C544D"  "#8C8278"               # light text
  "#4A6B5C"  "#3E5F4F"  "#8A6925"  "#8E3E3E"  "#4B6074"  # light signal+status
)
for hex in "${KEYS[@]}"; do
  lower=$(echo "$hex" | tr '[:upper:]' '[:lower:]')
  upper=$(echo "$hex" | tr '[:lower:]' '[:upper:]')
  if ! grep -qiF "$hex" "$DS_CSS"; then
    echo "❌ FAIL: $hex missing from palette.css"
    FAIL=1
  fi
  if ! grep -qiF "$hex" "$DS_JS"; then
    echo "❌ FAIL: $hex missing from palette.js"
    FAIL=1
  fi
done
[[ $FAIL -eq 0 ]] && echo "✅ palette.js ↔ palette.css all canonical hexes present"

echo ""
echo "═══ Raw #hex Usage (Phase 3 cleanup target) ═══"
WEB_HEX=$(grep -rnE '"#[0-9A-Fa-f]{6}"' /app/web/src/pages 2>/dev/null | wc -l)
MOBILE_HEX=$(grep -rnE "'#[0-9A-Fa-f]{6}'" /app/frontend/app 2>/dev/null | wc -l)
echo "  Web pages with raw #hex strings: $WEB_HEX"
echo "  Mobile screens with raw #hex strings: $MOBILE_HEX"
echo "  Target by end of Phase 3: 0 + 0"
[[ $WEB_HEX -gt 0 || $MOBILE_HEX -gt 0 ]] && WARN=1

echo ""
echo "═══ Banned Tailwind Classes (Phase 3 cleanup target) ═══"
for cls in "emerald-" "teal-" "slate-" "gray-" "neutral-" "zinc-"; do
  N=$(grep -rE "(bg|text|border)-${cls}[0-9]" /app/web/src/pages 2>/dev/null | wc -l)
  echo "  ${cls}* utility usage: $N (mapped to sage/graphite in Tailwind config — visually OK, codemod later)"
done

echo ""
if [[ $FAIL -gt 0 ]]; then
  echo "═══ RESULT: ❌ FAIL ($FAIL violation(s))"
  exit 1
elif [[ $WARN -gt 0 ]]; then
  echo "═══ RESULT: ⚠️  CLEAN (warnings only — Phase 3 backlog)"
  exit 0
else
  echo "═══ RESULT: ✅ CLEAN"
  exit 0
fi
