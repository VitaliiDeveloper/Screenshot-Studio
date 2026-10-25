# Art direction for store screenshots

Use this when the user wants screenshots that sell: "make it pop", "less boring", "like top apps",
or a restyle from a reference image. The project's `AGENTS.md` is still the contract for commands,
schema, and ids. This guide only decides *what* to build with them.

Every pattern below uses fields the strict schema already has. Do not invent effects, element types,
or fields to imitate something you saw elsewhere. If a look needs perspective, masks, radial
gradients, or a two-colour headline, say so and offer the closest pattern here instead.

## 1. Write the story before touching layout

1. Read the product brief, every capture in `assets/`, and the current screens of the target locale.
2. Write a slide outline, one line per slide: the user outcome, the capture that proves it, and the
   pattern from section 3 you will use.
3. Order it for the store shelf. Search results show only the first two or three slides, so they
   carry the decision:
   - Slide 1: the main outcome, in the user's words ("Fall asleep in 10 minutes", not "Sleep
     tracking feature"), with the strongest real UI.
   - Slides 2–3: the next two reasons to install, or problem → solution.
   - Social proof (rating, award, user count) by slide 3 or 4 when the brief supplies real numbers.
     Never invent ratings, review counts, awards, or press quotes; leave a clear placeholder and tell
     the user instead.
   - Remaining slides: secondary features, then a closing slide.
4. Captions are search text. Store search may index caption text, so put the words users search for
   into headlines naturally, and translate captions per locale rather than reusing English.
5. Store rules: every slide shows real in-app UI. Decoration frames the product; it never replaces it.

## 2. Copy rules

- Headline: 2–6 words, one idea, a verb or an outcome. It must read at thumbnail size (section 5).
- Subline: optional, at most about ten words, adds proof or context, never repeats the headline.
- One idea per slide. If a slide needs "and", split it.
- Numbers beat adjectives: "3× faster" over "blazing fast", when the brief supports the number.
- Keep the deck's voice consistent; vary composition, not tone.

## 3. Pattern catalog

Pick a pattern per slide so that adjacent slides differ visibly. Coordinates are artboard pixels.
`rotation` is in degrees and pivots on the element's top-left corner (`x`, `y`), so after rotating,
check the export and shift `x`/`y` to recentre. Edit geometry as JSON literals, as `AGENTS.md`
allows; use the CLI for copy and media.

| Pattern | Build it with | Use for |
|---|---|---|
| **Hero bleed** | One `device-frame` 75–90 % of artboard width, bottom 15–30 % below the artboard edge, `rotation` −8…8. Headline above, large. | Slide 1, the main outcome |
| **Callout zoom** | The device as usual, plus a `screenshot` leaf with the *same* `assetUrl`, `fit: "cover"`, `crop: { x, y, zoom: 2–3 }` aimed at one UI detail, `cornerRadius` ≈ 4 % of width, placed overlapping the device edge. Behind it, a `shape` rect 2–4 % larger with the same radius as a card or outline (`stroke`). | Showing one control, number, or result that is too small inside the phone |
| **Two devices** | Two `device-frame` leaves with different captures: the front one larger, the back one 80–90 % size, offset, `rotation` of opposite signs (e.g. −6 and 5), the back one optionally `opacity` 0.9. | Before/after, two related flows, light/dark |
| **Big number** | A `text` leaf at 2–3× headline size with the stat ("4.9★", "2M+", "−40 %"), a short label under it, a small device or none. | Proof slide, results apps |
| **Rating / award badge** | A one-level `group` of `icon` (`star`, `sparkles`, `check`, `heart`) and `text` leaves on a rounded `shape`. | Proof, inside or under the headline |
| **Frameless UI card** | A `screenshot` leaf (no device) with `cornerRadius`, 85–92 % width, on a contrasting `shape` card or background. | Dense UI, tablets and desktops, a fresher look than phone frames |
| **Depth background** | The same capture as a full-bleed `screenshot` or `image` with `blur` 20–40 and `opacity` 0.3–0.5 under the device; or 2–3 large `ellipse` shapes with low `opacity` (0.1–0.25) as glows. | Making a flat gradient feel rich |
| **Panorama** | A `connected` layout (`layout mode … --mode connected`) whose decoration (a stripe, a device, a shape) crosses screen seams. Required text and critical UI stay complete inside each artboard. | Sets that read as one continuous banner in the store |

Colour and type:

- One accent colour for emphasis (badges, stats, one shape); background and text from the theme.
- Contrast: headline against its background at least 4.5:1. On busy backgrounds put text on a
  `shape` panel or add a text `shadow`.
- Headline weight 700–900 and size about 6–9 % of the artboard's short side on phones; never set
  body copy below about 3 %.
- Gradients are two-stop linear (`background` or `shape.gradient`). Neighbouring hues read as
  premium; complementary hues read as loud.

## 4. Restyle from a reference image

When the user attaches a competitor or inspiration screenshot:

1. Describe it back in one short list: layout (where text, device, decoration sit), device treatment
   (size, tilt, bleed, frameless), colour (background, accent), type (weight, case, size relative to
   width), and the pattern names from section 3 that match.
2. Name what the schema cannot reproduce (perspective, masks, mixed-colour text, radial gradients,
   photos the project lacks) and the substitute you will use.
3. Map it onto the project: keep the user's captures, copy, and fonts; take only composition, scale,
   and colour. Never copy the reference's brand, logo, illustrations, or text.
4. Apply to one slide, export it, review (section 5), then roll the treatment out to the rest.

The reference image is context only. Do not import it into the project unless the user asks.

## 5. Export and look before you finish

Layout JSON is not evidence. After changing a slide:

```bash
screenshots export --screen <screen-id> --project ./app-store-screenshots.json
```

Open the PNG it wrote (the command prints the folder) with your file-reading tool and check it at two scales: full size, and as a
store thumbnail (imagine it about 20 % wide). Fix and re-export until:

- the headline is readable at thumbnail size and nothing important is clipped by the artboard,
  the device bezel, or another layer;
- the outcome of the slide is obvious in about a second;
- rotated or bled elements look intentional, not misplaced;
- adjacent slides use different compositions while sharing theme and type.

Export one screen at a time while iterating; export the locale once at the end.

## 6. Offer the critic

When the set is done, ask the user whether they want an independent critic pass. Do not start it
without a yes. If they agree, follow [`critic.md`](critic.md) as a separate, read-only step: switch
to its rules, judge the exported PNGs, and report findings without editing the project. Apply fixes
only after the user picks which findings to act on.
