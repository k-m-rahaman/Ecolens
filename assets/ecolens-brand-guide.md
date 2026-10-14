# EcoLens visual identity

The mark combines a growing leaf, a planet, a camera lens, and an open orbit. The leaf represents recovery; the lens represents looking carefully before sorting. The small orbit dot is the focal point. The same drawing is used everywhere, replacing the unrelated diamond and earth mascot.

## Assets

| File | Use | Canvas |
| --- | --- | --- |
| `ecolens-mark.svg` | Navigation, welcome artwork, about panel, reports | 160 × 160, transparent outside the forest disc |
| `icon.svg` | Favicon and installable app icon | 192 × 192, rounded forest tile |
| `ecolens-logo.svg` | Light-background slides or documents | 520 × 160, transparent wordmark lockup |

The app should use the mark image beside its existing live EcoLens text. This allows the wordmark to follow the selected light or dark theme. The full-logo file has forest text and is intended for light backgrounds. Its text uses local system fonts; it requires no font downloads.

## Colour

| Colour | Hex | Role |
| --- | --- | --- |
| Forest | `#174d3a` | Disc, typography, leaf vein |
| Leaf lime | `#bcf173` | Leaf and focus dot |
| Orbit mint | `#8fd3b2` | Orbit and planet outline |
| Planet green | `#24694e` | Planet interior |

## Integration

- Show the navigation mark at 48–56 px and the mobile mark at 30–36 px. Keep it square and avoid stretching.
- Use the mark at 120–160 px for welcome or about artwork. Add a gentle halo or a slow orbit in surrounding CSS, rather than moving the SVG geometry.
- Keep at least one eighth of the mark width clear around it. The SVG already provides a small transparent margin.
- When EcoLens text is immediately beside the mark, use an empty image `alt` to avoid repeated screen-reader names. Use `alt="EcoLens"` when the image stands alone.
- Respect reduced-motion settings for decorative animation.
- Reuse `assets/icon.svg` for the existing favicon and web-app manifest. Important artwork stays inside the central icon safe area.

The SVG files contain accessible titles and descriptions, no scripts, no external references, and no downloaded fonts. This is an original visual design for the project.
