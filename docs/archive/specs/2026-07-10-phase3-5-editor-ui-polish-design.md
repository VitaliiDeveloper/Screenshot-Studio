# Phase 3.5 — Editor UI polish

## Goal

Move the editor from a functional prototype to a coherent dogfooding workspace without changing
its data, rendering, persistence, or workflow contracts. The direction extends the existing
neutral/blue visual language into a calm creative workbench rather than introducing a new brand.

## Evidence and priorities

The current desktop editor, selected-element inspector, Fonts dialog, and empty Theme/Template
states were captured and reviewed at the same viewport before implementation. The highest-impact
issues are weak action hierarchy, cramped controls, inconsistent modal structure, emoji/text-symbol
icons, and empty states that describe the absence without explaining the project-local next step.

## Visible scope

- Add a compact product identity to the left panel and strengthen Screens/Layers hierarchy.
- Group toolbar actions into insert, project resources, export, and zoom; make Export primary.
- Replace emoji/text-symbol controls with one real icon library and consistent labelled tooltips.
- Standardize button, field, focus, selected, disabled, and destructive states.
- Give the left panel and inspector more breathing room while keeping the canvas dominant.
- Standardize Fonts, Themes, Templates, and Export dialogs around one shell.
- Restyle font upload and resource rows; make empty states explain the relevant project directory.
- Improve store-target status badges and secondary actions without changing validation behavior.

## Accessibility intent

Controls keep explicit accessible names, visible keyboard focus, and at least a compact 32px target.
State may not rely on color alone: status badges retain text, selected rows retain weight/background,
and destructive actions keep labels/tooltips. This is a visual/accessibility-risk pass, not a claim
of full WCAG compliance.

## Out of scope

Schema or API changes, renderer/canvas behavior, new editor actions, responsive/mobile redesign,
dark mode, design-token package extraction, asset browser, theme/template authoring, undo/redo,
snapping, connected canvas, and final Phase 6 brand/presentation polish.

## Verification

- Capture the same desktop states after implementation and compare against the accepted baseline.
- Exercise selection plus Fonts, Themes, Templates, and Export dialog open/close paths.
- Check page identity, blank/error overlays, console warnings/errors, focus/labels, and visual clipping.
- Run targeted editor e2e, full unit suite, lint, typecheck, and `git diff --check`.
