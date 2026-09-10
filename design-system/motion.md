# Motion

BUILD-PLAN.md §7. Library: Motion for React.

## The rule that decides everything

Motion has one job: explain what just changed, or where something came from.
Anything that does not do one of those is decoration, and decoration on a
transactional surface costs money.

§5 lists "motion that slows ordering" in the avoid column. That is the test —
if a customer has to wait for an animation before they can tap the next thing,
it is wrong regardless of how good it looks.

## Duration

| Token | Value | Use |
|---|---|---|
| micro | 120ms | Press feedback, checkbox, toggle, hover |
| standard | 200ms | Tab change, accordion, tooltip, colour shift |
| entrance | 320ms | Dialog, drawer, sheet, toast |
| hero | 560ms | Hero reveal on first paint only |

**Exits run at 70% of the entrance.** A thing leaving should get out of the way
faster than it arrived; matching durations makes dismissal feel sticky.

## The POS ceiling

**Nothing in `/app/pos` or `/app/kitchen` exceeds 120ms.** Not the order panel,
not the category switch, not the payment sheet.

A cashier taps something like 200 times an hour. At 300ms per transition that
is a minute per shift spent watching the interface catch up, during a rush,
with a queue. The POS gets press feedback and instant state changes. Nothing
else.

## Easing

```
standard    cubic-bezier(0.2, 0, 0, 1)    almost everything
decelerate  cubic-bezier(0, 0, 0, 1)      entering the screen
accelerate  cubic-bezier(0.3, 0, 1, 1)    leaving the screen
spring      stiffness 420, damping 32     tactile only
```

Spring is for things a finger should feel: add-to-cart, drawer drag, quantity
stepper. Not for opacity, not for colour, not for anything on the POS.

## Primitives

§7 asks for these as reusable components rather than one-off `motion.div`s
scattered through pages:

```
MotionReveal      MotionStagger     MotionFade      MotionScale
MotionSlide       MotionPress       MotionDrawer    MotionModal
MotionNumber      MotionStatus      MotionPageTransition
```

`MotionNumber` matters more than it looks: a total that changes should tick to
its new value, not snap. It is also the one place tabular numerals are
load-bearing — proportional digits make a counting number jitter horizontally.

## Specific behaviours

**Add to cart.** Button responds within 120ms — before the network. The cart
count updates when the server confirms. If the request fails, the count rolls
back and an error appears; §57, never make failure look like success.

**Order status.** A status change is the one place a longer transition earns
its keep. The customer is watching that screen and waiting. Moving from
"Preparing" to "Ready" should feel like something happened.

**AI.** Stream the text. Show a processing state while a tool runs. Never fake
a typing delay on a response that has already arrived.

**Kitchen tickets.** A new ticket arrives with a 120ms scale-in and nothing
else. Urgency is carried by the timer and the border, not by motion. §21: add
visual urgency without excessive colour — and without a flashing card.

## Reduced motion

```css
@media (prefers-reduced-motion: reduce)
```

Render the final state immediately. Do not disable the feature, do not
substitute a fade for a slide and call it done, and never leave a component
stuck mid-transition. Reduced motion must remain **fully functional** (§7).

Opacity-only transitions under 200ms may stay — they do not trigger vestibular
symptoms and removing them makes state changes harder to notice.

## Performance

Animate `transform` and `opacity`. Not `width`, `height`, `top`, `left`, or
anything that triggers layout. If a layout property must animate, use the FLIP
approach through Motion's layout animations rather than tweening the property.
