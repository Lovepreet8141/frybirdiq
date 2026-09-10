# Accessibility

BUILD-PLAN.md §55. Target: WCAG 2.2 AA.

Two of these audiences make accessibility load-bearing rather than optional: a
customer ordering one-handed on a phone at night, and a staff member using a
touchscreen and a keyboard on the same screen during a rush.

## Contrast — measured

Every pair in the brand palette, computed rather than eyeballed:

| Foreground | Background | Ratio | AA body | AA large |
|---|---|---|---|---|
| Cream | Charred | 16.49 | PASS | PASS |
| Cream | Charred 2 | 15.59 | PASS | PASS |
| Amber | Charred | 9.20 | PASS | PASS |
| Amber | Charred 2 | 8.70 | PASS | PASS |
| Ash | Charred | 8.39 | PASS | PASS |
| Ash | Charred 2 | 7.93 | PASS | PASS |
| Charred | Amber | 9.20 | PASS | PASS |
| Cream | Ember | 5.14 | PASS | PASS |
| Cream | Ember dark | 7.98 | PASS | PASS |
| **Ember** | **Charred** | **3.21** | **FAIL** | PASS |

### The consequence

Ember on the dark ground is legal only at 24px+, or 18.66px+ bold. It is not a
body colour, not a link colour, not a helper-text colour, and not an error-text
colour on a dark panel.

Error text on charred uses cream with an ember icon or an ember left border.
That keeps the brand signal and stays readable.

Re-run the check whenever a colour is added:

```bash
python3 scripts/check-contrast.py
```

## Colour is never the only signal

§10 of the UX priorities and §21 of the plan both land here. A kitchen ticket
does not communicate urgency by turning red alone — it also shows an elapsed
timer and a border weight. An order status is a labelled step, not a coloured
dot. A chart series carries a label or a pattern, not just a hue.

Roughly 1 in 12 men has some form of colour vision deficiency. In a QSR kitchen
that is a real person on a real shift.

## Keyboard

- Everything reachable, in visual order.
- Visible focus ring, always.
- Dialogs trap focus, `Esc` closes, focus returns to the trigger.
- The POS gets real shortcuts: search, quantity, pay, void.
- No keyboard trap. Ever.

## Screen readers

- Semantic HTML first. A `<button>` before a `div` with a click handler.
- Icon-only buttons have an accessible name. §67's `ProductQuickAdd` is a "+"
  to a sighted user and needs to be "Add Crispy Chicken Burger to cart" to a
  screen reader.
- Live regions for the cart total and for order status changes.
- Tables use real `<th>`, scope, and a caption.
- Decorative images — including the grain overlay — are `aria-hidden`.

## Touch and motor

- 44px minimum, 56px on the POS, 8px between targets.
- No action depends on a drag, a long-press, or a precise gesture without a
  simple alternative (WCAG 2.2 Dragging Movements).
- Nothing depends on hover.

## Motion and vestibular safety

`prefers-reduced-motion: reduce` renders final states immediately and keeps
every feature working. No parallax, no auto-playing large motion, no
scroll-jacking.

## Language

`lang="en"` on the document, `lang="hi"` on Devanagari runs. Without it a screen
reader reads Hindi menu descriptors with English phonetics.

## Zoom and reflow

Never `user-scalable=no`. The page reflows to 320px with no horizontal scroll
and stays usable at 200% zoom.

## What to check before shipping a screen

- [ ] Contrast measured for any new colour pair
- [ ] Keyboard-only pass, start to finish
- [ ] Focus visible at every step
- [ ] Icon-only buttons named
- [ ] Alt text on product images; decorative images hidden
- [ ] Reduced-motion pass
- [ ] 320px reflow, no horizontal scroll
- [ ] Error, empty, loading, offline and permission-denied states all present
