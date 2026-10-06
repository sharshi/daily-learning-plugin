#!/bin/sh
# The chitas mod's "Hebrew font" setting, applied: install the bundled
# Shlomo SemiStam font for this user and map Ghostty's Hebrew block to it,
# or with --remove take the Ghostty line back out. Safe to run every session:
# it changes nothing that is already in place, and prints a line starting
# with "changed:" only for what it did change.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
font="$root/fonts/ShlomoSemiStam.ttf"
family="Ezra SIL SR" # the font's internal family name, not "Shlomo SemiStam"
mark="# Hebrew in Shlomo SemiStam (chitas mod)"
line="font-codepoint-map = U+0590-U+05FF=$family"

# Ghostty reads $XDG_CONFIG_HOME/ghostty/config, and on macOS also
# ~/Library/Application Support/com.mitchellh.ghostty/config: use the one
# that exists, the XDG one first.
cfg="${XDG_CONFIG_HOME:-$HOME/.config}/ghostty/config"
mac="$HOME/Library/Application Support/com.mitchellh.ghostty/config"
if [ ! -f "$cfg" ] && [ -f "$mac" ]; then cfg="$mac"; fi

if [ "${1:-}" = "--remove" ]; then
  if [ -f "$cfg" ] && grep -qxF "$line" "$cfg"; then
    tmp="$cfg.chitas.$$"
    grep -vxF -e "$mark" -e "$line" "$cfg" > "$tmp" || true
    mv "$tmp" "$cfg"
    echo "changed: removed the Hebrew font line from $cfg"
  fi
  exit 0
fi

if [ "$(uname)" = Darwin ]; then
  dir="$HOME/Library/Fonts"
else
  dir="${XDG_DATA_HOME:-$HOME/.local/share}/fonts"
fi
if ! cmp -s "$font" "$dir/ShlomoSemiStam.ttf" 2>/dev/null; then
  mkdir -p "$dir"
  cp "$font" "$dir/"
  command -v fc-cache >/dev/null 2>&1 && fc-cache -f "$dir" >/dev/null 2>&1 || true
  echo "changed: installed Shlomo SemiStam ($family) to $dir"
fi

# Only touch Ghostty's config for Ghostty users, and never over a Hebrew
# mapping someone already chose.
if [ "${TERM_PROGRAM:-}" = ghostty ] || [ -f "$cfg" ]; then
  if [ -f "$cfg" ] && grep -q "U+0590" "$cfg"; then
    grep -qxF "$line" "$cfg" || echo "note: $cfg already maps Hebrew to another font; left as is"
  else
    mkdir -p "$(dirname "$cfg")"
    printf '\n%s\n%s\n' "$mark" "$line" >> "$cfg"
    echo "changed: mapped Ghostty's Hebrew to $family in $cfg"
  fi
fi
