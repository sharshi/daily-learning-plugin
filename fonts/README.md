# Shlomo SemiStam

`ShlomoSemiStam.ttf` is Shlomo Orbach's scribal (STaM-style) Hebrew font with
nikkud and te'amim, a derivative of SIL's Ezra SIL SR. It is shipped unmodified
under the SIL Open Font License 1.1; see `OFL.txt` for the copyright notices
and license.

Source: the Open Siddur Project's font pack,
https://github.com/aharonium/fonts (Fonts/Hebrew Letters with Vowels and
Cantillation/Shlomo Orbach (OFL)/ShlomoSemiStam.ttf).

The font's internal family name is **Ezra SIL SR** (inherited from its parent),
so that is the name a terminal config refers to it by, not "Shlomo SemiStam".

The mod's "Hebrew font" setting runs `scripts/install-font.sh`, which copies
the font into your user fonts folder and, for Ghostty, maps the Hebrew block
to it. `ShlomoSemiStam.woff` is the same font repackaged as WOFF (tables
compressed, font data unchanged) by `scripts/make-woff.py`, for the Desktop
app, which draws the sidebar's Hebrew as SVG with this font embedded.
