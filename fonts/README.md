# Fonts

Two Hebrew fonts with nikkud, for the "Hebrew font" setting. Both are shipped
unmodified under the SIL Open Font License 1.1.

| File | Font | Copyright and license |
|---|---|---|
| `Shlomo.ttf` | Shlomo, by Shlomo Orbach, a derivative of SIL's Ezra SIL SR. Its internal family name is still **Ezra SIL SR**. | `OFL-Shlomo.txt` |
| `FrankRuhlLibre-Regular.ttf` | Frank Ruhl Libre, by Yanek Iontef, a revival of Frank Rühl. | `OFL-FrankRuhlLibre.txt` |

Source: the Open Siddur Project's font pack, https://github.com/aharonium/fonts.

The `.woff` files are the same fonts repackaged as WOFF (tables compressed, font
data unchanged) by `scripts/make-woff.py`, for the Desktop app, which draws the
sidebar's Hebrew as SVG with the chosen font embedded.

For Ghostty, the setting runs `scripts/install-font.sh`, which copies the chosen
`.ttf` into your user fonts folder and maps Ghostty's Hebrew block to it.
