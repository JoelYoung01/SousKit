# SousKit mark brief — nested knife + fork

Recreate as original SVG (do not raster-trace any PNG). Match the composition of the reference mock the user provided.

## Composition (from reference)

- Solid near-black square canvas.
- Two utensils upright, side-by-side, nested into one silhouette:
  - **Left: chef’s knife** in soft off-white.
  - **Right: dinner fork** in brand green.
- Fork’s left edge seats into a recess / step on the knife’s right side (blade→handle transition). Shared boundary — one continuous inner seam, not a gap.
- Fork handle bottom aligns with knife handle bottom.
- Fork tines reach roughly **2/3** up the knife blade height.
- Knife outer (left) edge: smooth elegant curve to a slightly rounded tip; inner (right) blade edge mostly straight.
- Knife handle: straight sides, fully rounded bottom; small **circular rivet** near bottom of handle filled with the same green as the fork.
- Fork: **four** equal-width tines with rounded tops; tines join a base that tapers into a thinner neck, then a straight handle with rounded base matching the knife.
- All terminal ends soft-rounded. Flat fills only — no strokes, shadows, gradients, text, or extra ornaments.

## Brand colors (use these, not pure #fff / Apple green)

| Role | Hex |
|------|-----|
| Background | `#090b09` |
| Knife (off-white) | `#f4f7f5` |
| Fork + rivet | `#22c55e` |

## Technical

- ViewBox `0 0 1024 1024` (or `0 0 512 512` scaled equivalently).
- Mark centered; ~18–22% padding from edges (iOS safe area).
- Prefer `<path>` geometry; keep file tidy and editable.
- Output path: `mobile/assets/images/souskit-mark.svg`
