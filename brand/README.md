# Brand: RHIS house style

This folder holds the RHIS house style used by Network Simulator. It is a copy of
[`rhisijmuiden/rhis-huisstijl`](https://github.com/rhisijmuiden/rhis-huisstijl)
(commit `7e4805f`), which stays the central source: change the style there first
and copy it here afterwards.

| Path | Content |
| --- | --- |
| `huisstijlgids.md` | The full style guide (Dutch) |
| `tokens/tokens.css`, `tokens/tokens.json` | Colours, type, spacing and radius, light and dark |
| `fonts/archivo/` | Archivo variable web font, self-hosted |
| `logo/` | Word mark, icon, antenna and favicon (SVG, PNG) |

The web interface imports these files directly (`web/src/styles.css`), so the
app always follows the style in this folder.

Colours in short: **Nacht** `#14213D` (text, dark surfaces, sidebar), **Koraal**
`#FF6B57` (the antenna and the main call to action, text on coral is always
nacht), **Lucht** `#9CC3FF` (support colour on nacht) and **Wolk** `#F6F7FB`
(light background). Headings use Archivo at `font-stretch: 125%`, weight 800.
