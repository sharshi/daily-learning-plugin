#!/bin/sh
# The dl (Daily Learning) mod's "Hebrew font" setting, applied:
#
#   install-font.sh <file> <family>   install fonts/<file>.ttf for this user and
#                                     map Ghostty's Hebrew block to <family>
#   install-font.sh --remove          take the mod's Ghostty line back out
#
# Safe to run every session: it changes nothing already in place, and prints a
# line starting with "changed:" only for what it did change.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
mark="# Hebrew font (dl mod)"
# Comments earlier versions wrote above their line; theirs is replaced too.
old_marks='# Hebrew in Shlomo SemiStam (dl mod)|# Hebrew in Shlomo SemiStam (chitas mod)'

# Ghostty reads $XDG_CONFIG_HOME/ghostty/config, and on macOS also
# ~/Library/Application Support/com.mitchellh.ghostty/config: use the one
# that exists, the XDG one first.
cfg="${XDG_CONFIG_HOME:-$HOME/.config}/ghostty/config"
mac="$HOME/Library/Application Support/com.mitchellh.ghostty/config"
if [ ! -f "$cfg" ] && [ -f "$mac" ]; then cfg="$mac"; fi

if [ "$(uname)" = Darwin ]; then
  dir="$HOME/Library/Fonts"
else
  dir="${XDG_DATA_HOME:-$HOME/.local/share}/fonts"
fi

# The config without the mod's own Hebrew line (a marked comment and the
# font-codepoint-map line under it) and without blank lines at its end.
strip() {
  awk -v mark="$mark" -v old="$old_marks" '
    BEGIN { n = split(old, o, "|"); for (i = 1; i <= n; i++) ours[o[i]] = 1; ours[mark] = 1 }
    skip && /^font-codepoint-map = U\+0590-U\+05FF=/ { skip = 0; next }
    { skip = 0 }
    ($0 in ours) { skip = 1; next }
    NF { for (; b > 0; b--) print ""; print; next }
    { b++ }
  ' "$cfg"
}

# Replace the config with $1 (a file) when it differs.
put() {
  if ! cmp -s "$1" "$cfg"; then mv "$1" "$cfg"; return 0; fi
  rm -f "$1"; return 1
}

if [ "${1:-}" = "--remove" ]; then
  if [ -f "$cfg" ]; then
    tmp="$cfg.dl.$$"; strip > "$tmp"
    if put "$tmp"; then echo "changed: removed the Hebrew font line from $cfg"; fi
  fi
  exit 0
fi

file="$1"; family="$2"
line="font-codepoint-map = U+0590-U+05FF=$family"

# SemiStam, which earlier versions installed, shares Shlomo's family name.
if [ -f "$dir/ShlomoSemiStam.ttf" ]; then
  rm -f "$dir/ShlomoSemiStam.ttf"
  echo "changed: removed Shlomo SemiStam from $dir"
fi
if ! cmp -s "$root/fonts/$file.ttf" "$dir/$file.ttf" 2>/dev/null; then
  mkdir -p "$dir"
  cp "$root/fonts/$file.ttf" "$dir/"
  command -v fc-cache >/dev/null 2>&1 && fc-cache -f "$dir" >/dev/null 2>&1 || true
  echo "changed: installed $family to $dir"
fi

# Only touch Ghostty's config for Ghostty users, and never over a Hebrew
# mapping someone wrote themselves.
if [ "${TERM_PROGRAM:-}" = ghostty ] || [ -f "$cfg" ]; then
  mkdir -p "$(dirname "$cfg")"
  [ -f "$cfg" ] || : > "$cfg"
  tmp="$cfg.dl.$$"; strip > "$tmp"
  if grep -q "^font-codepoint-map = U+0590" "$tmp"; then
    rm -f "$tmp"
    echo "note: $cfg already maps Hebrew to a font of your own; left as is"
  else
    [ -s "$tmp" ] && echo >> "$tmp"
    printf '%s\n%s\n' "$mark" "$line" >> "$tmp"
    if put "$tmp"; then echo "changed: mapped Ghostty's Hebrew to $family in $cfg"; fi
  fi
fi
# Nothing left to do is success, not an error: a run that changed nothing exits 0.
exit 0
