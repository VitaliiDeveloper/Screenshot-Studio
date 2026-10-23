# AGENTS.md — Screenshot Studio project

This directory is a screenshots project, not the Screenshot Studio application source. Work through
the strict `app-store-screenshots.json` contract and the `screenshots` CLI. Keep the project usable
without an agent: agent assistance generates ordinary copy, layout literals, and localized assets.

## Command spelling

The recipes use the packaged command name:

```bash
screenshots <command> --project ./app-store-screenshots.json
```

Use that plain spelling whenever `screenshots` is on `PATH`. Otherwise, from the Screenshot Studio
source checkout, run the same command as `pnpm screenshots` from that checkout and pass this
project's JSON with `--project`.

## Source of truth and guardrails

- `app-store-screenshots.json` is the only persisted project state. It is strict v1 JSON; unknown
  keys fail validation.
- Use CLI commands for structural changes to layouts, screens, templates, locales, fonts, themes,
  and imports, and for copy and media (`element text`, `element media`). Each command takes the
  project lock, validates the complete strict Project, and writes atomically. Directly edit JSON
  only for literals the CLI does not manage, such as element geometry, typography, screen names,
  and backgrounds.
- The visual editor may be open on this project. It refuses to save over a newer file ("Project
  changed on disk"), so reload it after CLI or JSON changes made outside it.
- Preserve layout, screen, and element ids unless intentionally creating a new object. Layout ids
  are immutable. Array order is layout order, layout-local screen order, and z-order inside `elements`.
- Asset and font paths are project-relative. Do not embed remote URLs, machine-only absolute paths,
  or system-font fallbacks.
- Every text `(fontFamily, weight)` must match a registered file in `fonts`. Add the font before
  assigning that identity.
- Layout is literal. There is no responsive constraint engine: write final `x`, `y`, `width`, and
  `height` values for each artboard.
- Choose layout mode explicitly with `screenshots layout add "Name" --mode isolated|connected`.
  Change an existing layout without rewriting its content with
  `screenshots layout mode "Name" --mode isolated|connected`.
- RTL is explicit and baked. Never reflect screenshot or device media pixels.
- Do not add prompt history, translation-pair ids, nested groups, clipping/scale state, new element
  types, or any other field outside the enforced schema.
- Keep each exported artboard useful by itself and preserve render/export parity.

## Enforced v1 shape

```text
Project
├── meta: { name, appIcon?, schemaVersion: 1 }
├── fonts: FontAsset[]                    # file-backed project fonts
├── preferredExportLayoutId: string
└── layouts: DesignLayout[]
    ├── id, name, mode: isolated | connected
    ├── screenSetPolicies?: ScreenSetPolicy[] # per output family/locale; independent | synchronized
    └── screens: Screen[]
        ├── id, name, platform, device, locale, direction
        ├── variantOf?, storeTargetId?      # paired only on explicit target variants
        ├── artboard: { width, height }
        ├── background: solid | linear-gradient | project image
        └── elements: Element[]             # array order is z-order
```

Leaf element types are `text`, `shape`, `screenshot`, decorative `image`, trusted built-in `icon`,
and `device-frame`; `group` contains a
non-empty, non-nested `children` array of those leaves in group-local coordinates. All top-level
elements share literal position, size, rotation, opacity, lock, and visibility fields. A group is
non-clipping and occupies one screen z-order slot; child array order is z-order inside it. Inspect
the current project and its registered fonts before changing copy or layout; do not reconstruct
objects from this summary.

Badges are compositions, not a `badge` element type. Rating and “as seen on” badges are ordinary
one-level groups of shape/icon/text leaves; official store badges are ordinary contain-fit `image`
elements. Preserve and edit their literal children like any other group/image.

Screenshot and decorative-image leaves may store normalized `crop: { x, y, zoom }`: focal `x/y`
are in `0…1`, zoom is `1…4`, and the literal affects `cover` only. `contain` keeps but ignores it.
Text may store one literal shadow. Shapes may be rect or ellipse and may add a two-stop linear
gradient and stroke; do not invent generic effects, paths, or extra stops.
Device frames use one of the current strict preset ids below. The first eight ids are retained for
backward compatibility; all presets use shared-core, brand-neutral vector geometry, and rendering
never downloads vendor artwork.

<!-- DEVICE_FRAME_IDS:START -->
```text
iphone
android-phone
tablet
desktop
laptop
browser
tv
watch
phone-modern-dark
phone-modern-light
phone-punch-hole-dark
phone-outline
frameless-phone
tablet-rounded-dark
tablet-rounded-light
tablet-outline
frameless-tablet
browser-light
browser-dark
browser-minimal
frameless-browser
laptop-silver
laptop-dark
display-stand
display-minimal
tv-flat
watch-rounded
watch-square
frameless-watch
foldable
foldable-tall
phone-flip
automotive-display
xr-viewport
```
<!-- DEVICE_FRAME_IDS:END -->

Background literals are strict. `solid` stores `color`; `linear-gradient` stores `from`, `to`, and
an `angle` from 0 to 360; `image` stores a project-relative `assetUrl`, `cover | contain` fit, and
an RGB or alpha-bearing RGBA fallback/letterbox `color`. Keep background assets inside the project and use the same
shared render/export path as every element.

Each layout is independent and has one persisted mode. Screen ids, locale sets, variants, and
elements are layout-local; fonts and asset paths are shared. Trimmed layout names are
case-insensitively unique. `preferredExportLayoutId` is the CLI export default, not editor state.
Use `screenshots layout list` to inspect ids/names/modes. Layout-aware mutations infer the layout
only when exactly one exists; in multi-layout projects pass `--layout <id-or-full-name>`.

`screenSetPolicies` records the authoring behavior for one platform/device/locale output family.
Missing policy rows retain `independent` behavior; `synchronized` is the persisted form of the
editor's **Keep 1:1** mode and requires every exact-size target to match the root screen count and
order. The policy changes structural screen operations, not rendered pixels.

`isolated` clips every screen independently. In `connected`, each exact
platform/device/locale/`storeTargetId` group forms a gapless horizontal strip in layout order;
root screens have no `storeTargetId`, while explicit variants pair `variantOf` with a target id and
must not be mistaken for duplicate roots. Elements stay owned by one screen with owner-local coordinates,
and export crops the requested artboard through the
shared renderer. Connected Overview authors the complete exact group; Focus previews one exact crop.
Selecting a cross-screen element resolves to its owner screen, and transforms stay owner-local.

The recipes below omit `--layout` only for a one-layout project. In a multi-layout project, first
run `screenshots layout list`, choose the intended id or full name, and add
`--layout <id-or-full-name>` to every screen, template, element, locale, theme, import, and export
command.

## Command map

Inspect before mutating. Every listing prints one line per item with ids you pass back verbatim:

```bash
screenshots layout list --project ./app-store-screenshots.json      # id, name, mode
screenshots screen list --project ./app-store-screenshots.json      # order, screen id, family, locale, name
screenshots locale list --project ./app-store-screenshots.json      # locale, direction, screen count
screenshots template list --project ./app-store-screenshots.json    # source, id, family, target, name
# screen packs: built-in-pack, id, family, style (a Design pack id), screen count, name
screenshots theme list --project ./app-store-screenshots.json       # source, id, name (built-in = Design packs)
screenshots element list --locale en --project ./app-store-screenshots.json
# screen id, locale, element id, type, role, then JSON-quoted text or the media path ("-" when empty)
```

| Request | Commands |
|---|---|
| New screen from a starter or project template | `template add <id> --locale <locale> [--built-in]` |
| Blank screen | `screen add --platform <p> --device <d> --locale <locale>` |
| Change copy on every exact size of a slot | `element text <screen-id> <element-id> --all-sizes "<copy>"` |
| Replace a screenshot or image | `element media <screen-id> <element-id> <project-relative-path>` |
| Add a locale | `locale add <target> --from <source> [--direction rtl]` |
| Add every screen of a built-in screen pack | `template add <pack-id> --pack --locale <locale>` |
| Restyle with a theme or Design pack | `theme set <id> [--built-in]` |
| Reorder or remove screens | `screen reorder <id> --to <n>`, `screen rm <id> [--cascade]` |
| Register a font | `font add <file> --family <family> [--weight <100..900>]` |
| Import raw captures | `import <dir>` |
| Export a bundle | `export [--locale <l>] [--platform <p> --device <d>]` |
| Export one screen | `export --screen <id> [--size <target-id>]` (no bundle filters) |

Element ids are fresh UUIDs after a template add or locale clone, so list before every edit.
Store target variants are separate screens with their own elements and ids. `element text
--all-sizes` also writes the same layer on every other exact size of that slot, matched by layer
position like the editor's Status by size and Apply to, in one locked write. It reports each size it
skips: a size whose layer structure has diverged, or whose matching layer or its group is locked.
Edit those individually. Copy that starts with `--` goes after a `--` terminator:
`element text <screen-id> <element-id> -- "--flag-like copy"`.

## Recipe: generate or refresh copy

1. Read the product brief, current captures, and every screen in the target locale. Write a short
   slide outline before editing: one user outcome per slide, ordered as a coherent store story.
2. Keep headlines short enough for the one-second thumbnail test. Supporting copy should add proof
   or context, not repeat the headline.
3. Edit only the target locale's text content. List it, then set each string:

   ```bash
   screenshots element list --locale en --project ./app-store-screenshots.json
   screenshots element text <screen-id> <element-id> --all-sizes "Track every run" --project ./app-store-screenshots.json
   ```

   The command changes only `content` and keeps ids, roles, font identities, and unrelated locales.
   Prefer `--all-sizes` so exact-size variants do not drift, and handle any reported skipped size.
   If copy no longer fits, adjust that text element's literal box/typography in JSON and then
   visually inspect it; do not add an automatic runtime layout rule.
4. Make adjacent slides visibly different in composition while keeping the deck's theme and type
   hierarchy consistent.
5. Validate and inspect the affected set:

   ```bash
   screenshots screen list --project ./app-store-screenshots.json
   screenshots dev --project ./app-store-screenshots.json
   screenshots export --locale en --project ./app-store-screenshots.json
   ```

## Recipe: lay out slides

1. Prefer an existing screen or a template that already fits the platform/device. A template is an
   input: adding one appends an ordinary screen with literal fields and fresh ids, and never changes
   existing screens. Built-in starters need `--built-in`; project templates live in
   `templates/<id>.json` with `id`, `name`, `platform`, `device`, optional store `targetId`,
   `artboard`, `background`, and `elements`. Every template text font must already be registered.

   ```bash
   screenshots template list --project ./app-store-screenshots.json
   screenshots template add iphone-starter --built-in --locale en --project ./app-store-screenshots.json
   screenshots template add hero-card --locale en --project ./app-store-screenshots.json
   ```
2. Establish the hierarchy first: headline, proof/supporting copy, product media, then decoration.
   Keep required text and critical UI inside one artboard.
3. Write final element geometry against that screen's exact artboard. Keep all finite dimensions
   positive, preserve intentional aspect ratios for media, and remember that `elements` order is
   back-to-front z-order.
4. Vary device placement and negative space across adjacent slides. In `isolated` mode, never make
   one slide depend on a neighbouring crop. In `connected` mode, cross-screen decoration may span an
   exact platform/device/locale strip, but required text and critical UI must remain complete in
   every exported artboard.
5. Inspect Focus and Overview in the editor, then export the affected locale. Exported PNGs, not the
   editor chrome, are the final layout evidence.

## Recipe: translate a locale

1. Inspect the available source sets and their directions:

   ```bash
   screenshots locale list --project ./app-store-screenshots.json
   ```

2. Clone the complete source locale before translating. Choose RTL explicitly when needed:

   ```bash
   screenshots locale add es --from en --project ./app-store-screenshots.json
   screenshots locale add ar --from en --direction rtl --project ./app-store-screenshots.json
   ```

3. Translate only text content in the cloned target set with `element list --locale <target>` and
   `element text --all-sizes`. Preserve the fresh ids, roles, geometry, and source locale. Adapt phrasing for
   the store audience; do not force a word-for-word translation into a box that no longer fits.
4. Replace screenshots or other media only when a locale-specific asset exists (see the media
   recipe). Shared asset paths are intentional until then.
5. Verify that every target glyph is covered by the registered file-backed font. If a different font
   is required, register it first and update `fontFamily` plus `weight` as one identity.
6. Inspect and export only the target locale:

   ```bash
   screenshots screen list --project ./app-store-screenshots.json
   screenshots dev --project ./app-store-screenshots.json
   screenshots export --locale ar --project ./app-store-screenshots.json
   ```

Locale copies are independent after cloning. Do not create a sidecar translation database or add
pairing fields to the project.

## Recipe: replace a screenshot or image

1. Put the file inside the project first, for example `assets/captures/uk/03.png`. The command
   accepts only an existing project-relative PNG, JPEG, or WebP file of 25 MB or less, and refuses
   absolute paths, `..`, and symlinks that leave the project.
2. Find the target leaf and assign the path:

   ```bash
   screenshots element list --screen <screen-id> --project ./app-store-screenshots.json
   screenshots element media <screen-id> <element-id> assets/captures/uk/03.png --project ./app-store-screenshots.json
   ```

   `screenshot`, decorative `image`, and `device-frame` leaves (including group children) accept
   media. Only `assetUrl` changes; fit, crop, and geometry stay as they were. On a `device-frame`
   the path is the screenshot shown inside the frame, the same as the editor's **Replace
   screenshot**. The frame preset (`deviceType`) and its geometry are not media; change them with the
   editor's **Choose frame**. Media is per screen, so assign it on each exact size that should show
   it. Screen backgrounds are JSON literals, not elements.
3. Inspect the affected screen in the editor or with a targeted export.

## Recipe: choose a style

Use this when the user wants a ready-made look. Built-in packs are read-only application resources;
applying one writes ordinary literals, and the pack id is not stored anywhere in the project.

1. List what exists and offer only ids that appear. Design packs come from `theme list` (`built-in`
   lines). Screen packs come from `template list` (`built-in-pack` lines); a screen pack's style is
   the id of the Design pack its screens were baked from.

   ```bash
   screenshots theme list --project ./app-store-screenshots.json
   screenshots template list --project ./app-store-screenshots.json
   ```

2. Choose one path:
   - Restyle the screens you have with a Design pack:
     `screenshots theme set <design-pack-id> --built-in`. It replaces the background of every
     screen in the layout.
   - Add finished screens from a screen pack:
     `screenshots template add <pack-id> --pack --locale <locale>`. It appends every pack screen to
     the layout in one write and prints the new screen ids.
     A fresh `screenshots init` project starts with a blank `hero` screen that stays first and would
     be exported, so remove it with `screenshots screen rm hero` when the pack screens replace it.
3. Edit the copy. The screens carry placeholder text and an empty mockup, so list the leaves and
   replace each string and screenshot (see the copy and media recipes):

   ```bash
   screenshots element list --locale <locale> --project ./app-store-screenshots.json
   screenshots element text <screen-id> <element-id> --all-sizes "Track every run" --project ./app-store-screenshots.json
   ```

After this the result is plain project JSON: add or remove layers freely.

## Recipe: apply a theme or design pack

```bash
screenshots theme list --project ./app-store-screenshots.json
screenshots theme set neutral-default --built-in --project ./app-store-screenshots.json
screenshots theme set midnight --project ./app-store-screenshots.json
```

Both bake literals into role-tagged leaves (`role`: `heading`, `body`, `accent`, `surface`). A
theme sets text color, swaps the text font when the theme names one, and sets shape fill, and leaves
backgrounds alone. A Design pack also sets the font, text size, line height, and letter spacing,
recolors icons, and replaces the background of every screen in the layout. Neither moves or resizes
elements, nor changes untagged elements or media paths. No theme or pack id is persisted, so
re-apply after adding screens. A project theme is `themes/<id>.json`:

```json
{
  "id": "midnight",
  "name": "Midnight",
  "colors": { "heading": "#F8FAFC", "body": "#CBD5E1", "accent": "#38BDF8", "surface": "#0F172A" },
  "fonts": { "heading": { "family": "Inter", "weight": 700 } }
}
```

`fonts` is optional, and each font it names must be registered first. For a dark look, write a dark
theme, apply it, then set each screen's `background` literal in JSON and inspect contrast.

## Recipe: import PNG captures

Use the capture import command for raw screenshots, not for a complete Project transfer. The input is
either the project root or its `screenshots/` directory. Organize captures under the exact current
destination/device paths below; Apple, Android, Windows, and Web families all use the same
`{locale}/NN.png` convention:

<!-- SCREEN_CAPTURE_DESTINATIONS:START -->
```text
screenshots/apple/iphone/{locale}/NN.png
screenshots/apple/ipad/{locale}/NN.png
screenshots/apple/macos/{locale}/NN.png
screenshots/apple/tvos/{locale}/NN.png
screenshots/apple/watchos/{locale}/NN.png
screenshots/apple/visionos/{locale}/NN.png
screenshots/android/phone/{locale}/NN.png
screenshots/android/tablet-7/{locale}/NN.png
screenshots/android/tablet-10/{locale}/NN.png
screenshots/android/chromebook/{locale}/NN.png
screenshots/android/tv/{locale}/NN.png
screenshots/android/wear/{locale}/NN.png
screenshots/android/automotive/{locale}/NN.png
screenshots/android/xr/{locale}/NN.png
screenshots/windows/desktop/{locale}/NN.png
screenshots/windows/xbox/{locale}/NN.png
screenshots/windows/holographic/{locale}/NN.png
screenshots/web/desktop/{locale}/NN.png
screenshots/web/laptop/{locale}/NN.png
screenshots/web/tablet/{locale}/NN.png
screenshots/web/mobile/{locale}/NN.png
```
<!-- SCREEN_CAPTURE_DESTINATIONS:END -->

When importing from the project root, project-relative files under `assets/` are also supported.

Choose the receiving layout explicitly in a multi-layout project, then run:

```bash
screenshots import . --layout "Feature campaign" --project ./app-store-screenshots.json
```

The command uses the same bounded, path-safe discovery and deterministic plan as launcher preview,
creates fresh screen/element ids, validates the complete strict Project, and commits Project plus
copied resources atomically. Warnings identify skipped unsupported inputs; invalid or colliding paths
block apply. Do not use **Import project** Folder/ZIP/JSON terminology for this command, and do not
manually copy captures into `assets/imports/` or precompute ids.

## Recipe: process a local asset

Both asset commands are explicit and non-destructive. Relative input paths resolve from the project
root; results are new collision-safe PNGs under `assets/processed/`. The command prints the exact
project-relative path, but never rewrites an element automatically.

```bash
screenshots asset auto-crop assets/icons/product.png --threshold 10 --project ./app-store-screenshots.json
screenshots asset remove-background assets/icons/product.png --background FFFFFF --tolerance 24 --project ./app-store-screenshots.json
```

- `auto-crop` removes edge-connected margins matching the top-left colour within the threshold.
- `remove-background` makes matching edge-connected pixels transparent. Omit `--background` to use
  the top-left colour; use a six-digit RGB value when the intended background is known.
- Background removal is for flat or near-uniform backgrounds. It is not semantic object/person
  segmentation; do not apply it blindly to a complex photographic scene.
- Inspect the processed PNG before assigning its printed path to `assetUrl`. Preserve the source and
  keep processed assets in git when project elements depend on them.

## Completion checklist

- The CLI can list the project without a validation error.
- Copy and media changes are limited to the intended layout, locale, and screens.
- Every text font identity is registered and contains the required glyphs.
- Focus and Overview show no accidental overlap, clipping, or broken hierarchy.
- A targeted export succeeds with exact dimensions and store-ready opaque PNG output.
- The git diff contains only deliberate project and asset changes.
