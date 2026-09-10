# Interaction

BUILD-PLAN.md §55, §56. Verified against WCAG 2.2 and platform guidance.

## Touch targets

| Surface | Minimum | Why |
|---|---|---|
| Customer web | 44 × 44px | iOS guidance, above the WCAG 2.2 24px floor |
| POS / KDS | **56 × 56px** | Staff moving fast, often with wet or gloved hands |
| Adjacent gap | 8px | Anywhere two targets sit side by side |

The POS number is not the web minimum with padding added. A mis-tap at the
counter during a rush either voids a sale or adds an item nobody ordered, and
both cost more than the screen space.

`touch-action: manipulation` on every interactive element — without it mobile
browsers add a ~300ms delay waiting to see if the tap is a double-tap.

## Hover does not exist

No interaction may depend on hover. The customer is on a phone and the POS is a
touchscreen; on both, a hover state is either unreachable or fires on tap and
sticks.

Hover is a nicety for the small share of desktop users. It never reveals an
action, a price, a control, or information needed to complete a task.

## Focus

Every interactive element shows a visible focus ring. Never `outline: none`
without an equal replacement.

The POS is genuinely dual-input: a keyboard is faster than a touchscreen for a
practised cashier, and §55 calls this out specifically. Every POS action needs
a keyboard path, and tab order has to follow the visual order of the panels —
categories, products, order, pay.

## Every state

§56, all eight, for every interactive feature:

| State | Rule |
|---|---|
| default | — |
| loading | Feedback within 100ms. Skeleton for content, spinner for actions. |
| success | Confirm what happened, not that "it worked". |
| error | Say what failed and what to do next. Beside the field, not only at the top. |
| empty | Say what would be here and how to get it. Never a blank panel. |
| disabled | Explain why, or do not render it at all. |
| offline | Explicit. Queued actions say they are queued. |
| permission denied | An honest message. Not a hidden button. |

The last two are the ones that get skipped and the two that matter most here:
§20 makes the POS offline-first, and §41 is explicit that hiding a button is
not authorization.

## Forms

- Visible labels. Never placeholder-as-label — it disappears exactly when the
  user needs it.
- Validate on blur, not on every keystroke. Re-validate on submit.
- Errors sit next to the field they belong to.
- Phone and pincode inputs use `inputmode="numeric"`.
- The rupee field accepts what a person actually types — `2,800`, `₹2800`,
  `2800.50`. `fromRupees` in `src/lib/money` parses all of them.

## Navigation

- Bottom nav on mobile, maximum 5 items.
- Back always goes back. Never trap a customer in a checkout step.
- Every meaningful screen is deep-linkable — an order status URL has to survive
  being pasted into WhatsApp.

## Accessibility floor

Detail in `accessibility.md`. Non-negotiable: semantic HTML, keyboard reachable,
visible focus, alt text on every product image, labelled icon-only buttons,
AA contrast, reduced motion respected.
