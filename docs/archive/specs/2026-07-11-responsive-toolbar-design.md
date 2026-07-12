# Responsive Toolbar Design

## Goal

Keep the canvas-view switch visually anchored to the browser centre while preserving access to the primary editor actions at narrow window widths.

## Layout contract

- The `Focus` / `Overview` segmented control is positioned at the horizontal centre of the header independently of the left brand and right action groups.
- At compact widths, the view buttons show icons only. Their accessible names and tooltips continue to expose `Focus` and `Overview`.
- At wider widths, the existing text labels return next to their icons.
- `Export` follows the same responsive rule: icon only at compact widths and icon plus text at wider widths.
- `Undo` and `Redo` are hidden at compact widths. Keyboard shortcuts remain available, so hiding the buttons does not remove the actions.
- The product name `Screenshot Studio` returns from the `md` breakpoint because compact actions leave enough room for it.
- The project name stays hidden until `xl`; compact widths show the product icon alone and must not render both names.
- If the viewport becomes too narrow for the centred control and the required right-side actions, secondary right-side controls may collapse before the centred control moves.

## Component boundary

This remains a presentation-only change in the shared `Toolbar` component. It uses CSS breakpoints and existing button primitives; it adds no viewport state, effects, or alternate action handlers.

## Accessibility

- Icon-only controls retain explicit `aria-label` values.
- Icon-only controls receive matching `title` tooltips where the visible label is removed.
- Pressed, disabled, keyboard-focus, and click behaviour remain unchanged.

## Verification

- Verify that the view switch centre aligns with the viewport centre at compact and desktop widths.
- Verify no horizontal page overflow or overlap between toolbar groups.
- Exercise both `Focus` and `Overview` after the responsive change.
- Confirm full labels return on desktop.
- Run targeted TypeScript, ESLint, and diff checks for the web surface.
