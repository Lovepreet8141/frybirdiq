# FRYBIRD IQ — Design System

Source of truth. BUILD-PLAN.md §66: "Every UI change must respect this hierarchy."

Order of authority: this file → `tokens.json` → the page spec in `pages/` → the
component. A page spec may override Master for that page and nowhere else. A
component overrides nothing.

---

## 1. What this product is

One platform, three audiences, one brand (§1):

| Surface | Who | Feels like |
|---|---|---|
| Customer website | 18–30 in Ambala, on a phone, at night | Fast. Premium. Hungry. |
| Web POS + KDS | Staff mid-rush, on a tablet | Fast. Obvious. Reliable. |
| IQ dashboard | The owner, once a day | Control. Clarity. Intelligence. |

These have opposite needs and one visual language. The customer site can spend
a beat on delight; the POS cannot spend a frame. Where they conflict, the rule
is: **motion serves the customer surfaces, density serves the operational
ones.** Never the reverse — §7's "motion that slows ordering" is in the avoid
list for a reason.

---

## 2. Brand

**Locked.** The identity is not up for redesign; only the interface around it.
Ember red, charred ground, cream type, one amber accent.

| Token | Hex | Use |
|---|---|---|
| Ember | `#C21F11` | The brand red, taken from the box |
| Ember dark | `#8E1409` | Pressed states, deep fills |
| Charred | `#1F0705` | Page background |
| Charred 2 | `#2B0B07` | Raised panels, cards |
| Cream | `#F5EDD8` | Type, the logo |
| Amber | `#F2A324` | The single accent — primary buttons, the dot on the `I` |
| Ash | `#C3A597` | Secondary text |

Tagline: **Born crispy. Built bold.** Badge line: Hot · Crispy · Bold.

### The one hard colour rule

Contrast was measured, not assumed:

| Pair | Ratio | Verdict |
|---|---|---|
| Cream on Charred | 16.49 | AAA |
| Cream on Charred 2 | 15.59 | AAA |
| Amber on Charred | 9.20 | AAA |
| Ash on Charred | 8.39 | AAA |
| Charred on Amber | 9.20 | AAA — amber buttons take charred labels |
| Cream on Ember | 5.14 | AA |
| **Ember on Charred** | **3.21** | **Fails AA for body text** |

**Ember is never body copy on a dark ground.** It is legal for display type at
24px+, or 18.66px+ bold, and for fills, rules and borders where contrast does
not apply. For anything a customer has to read at body size, use cream, or ash
when it is genuinely secondary. Amber is the accent that survives at any size —
which is exactly why there is only one of it.

Ember carries the brand. Amber carries the action. Do not swap them: an
interface where everything is red has no call to action left.

---

## 3. Typography

Three families, each with one job.

| Role | Family | Why |
|---|---|---|
| Display | **Archivo** (variable, width axis widened) | Echoes the wordmark. Headlines, product names, KPI labels. |
| Body | **Manrope** | Reads cleanly at 14–18px on a phone at night. |
| Devanagari | **Baloo 2** | Menu descriptors only — never a headline. |

Numbers get their own treatment, per §6. Prices, totals, KPI values and every
column in the POS and the dashboard use `font-variant-numeric: tabular-nums`.
Proportional digits make a column of rupee amounts ragged and a changing total
jitter, which on a POS reads as a bug.

### Scale

| Step | Size / line-height | Weight | Use |
|---|---|---|---|
| Display | 48–96px clamp / 0.95 | 700 | Hero only |
| H1 | 32–48px / 1.05 | 700 | Page title |
| H2 | 24–32px / 1.15 | 600 | Section |
| H3 | 20px / 1.25 | 600 | Card title |
| Body L | 18px / 1.55 | 400 | Lead paragraph |
| Body | 16px / 1.55 | 400 | Default — never below this for prose |
| Small | 14px / 1.45 | 400 | Dense tables, metadata |
| Caption | 12px / 1.4 | 500 | Timestamps, helper text. Never for prose. |
| Label | 12px / 1.2, 0.08em tracking, uppercase | 600 | Field and KPI labels |
| Price | 16–20px / 1.2, tabular | 600 | Menu and cart |
| KPI | 32–44px / 1.0, tabular | 700 | Dashboard tiles |

Body text is 16px. 12px is for captions and never for something a customer has
to read to order.

---

## 4. Space, radius, elevation

Spacing is a 4px base scale: 4, 8, 12, 16, 24, 32, 48, 64, 96.

Density differs by surface, and this is deliberate:

- **Customer** — generous. Section gaps 48–96px. Room for the food to breathe.
- **Dashboard** — standard. 16–32px. Dense enough to answer §84's "today's
  business in under 30 seconds" without scrolling.
- **POS / KDS** — tight but never cramped. 8–16px gaps, large targets. The
  constraint is fingers, not pixels.

Radius: `sm` 4px, `md` 8px, `lg` 12px, `xl` 16px, `full` 9999px. §5 lists
"excessive rounded cards" in the avoid list — default to `md`, reserve `xl` for
the hero and full-bleed imagery.

Elevation on a dark ground comes from **surface lightness first, shadow
second**. Charred 2 panels on a Charred page read as raised without a shadow.
Shadows are for genuinely floating things — dialogs, drawers, the cart. §5
forbids "excessive translucent panels": no glass, no blur stacks.

Texture: a subtle grain overlay is part of the brand (§5 "subtle grain/noise").
One layer, at low opacity, on large dark fields only. Never on text, never on
the POS.

---

## 5. Colour tokens are semantic

Never hard-code a brand hex in JSX. §6: "Never hard-code brand colors
throughout JSX."

```
background        charred        surface           charred-2
foreground        cream          surface-elevated  charred-2 lifted
muted-foreground  ash            border            cream @ 14%
primary           amber          on-primary        charred
secondary         ember          on-secondary      cream
accent            amber          destructive       ember
success           (green)        warning           amber
```

Success is the one colour outside the brand set, because a kitchen ticket that
has gone green cannot also be the brand red — status has to survive being
glanced at from two metres away. It is used only for status, never decoration.

### Charts (staff surface only)

A data series is drawn in the neutral, never the brand red: on the IQ
surface red is what an alert looks like, and a sparkline of ordinary
Tuesdays must not read as a warning.

```
chart-1  #55504A  ink grey — the default series
chart-2  #0F7B4F  success — status only, never a channel or a series
chart-3  #726C63  muted grey — a second, quieter series
chart-4  #C2410C  warning orange — over target, late, at risk
chart-5  #D92B2B  red — an alert series, and nothing else
```

### Order tints (staff surface only)

The orders list tells four order *types* and five order *statuses* apart at a
glance, at row height, from across a counter. That needs more hues than the
brand has, so these are semantic tokens of their own — defined on the IQ
surface, never used on the customer site, and never for anything but an order
type or status. Each type carries a tinted ground, a readable ink for it, a
hairline, and a solid swatch for controls; each status a dot, a tinted ground
and its ink. Every ink-on-ground pair is AA for body text (checked by
`scripts/check-contrast.py`).

```
type.dineIn     ground #F1E6FF  ink #4C1D95  line #E3D2FA  swatch #7C3AED
type.takeaway   ground #FFEDD5  ink #7C2D12  line #FBD9B5  swatch #EA580C
type.delivery   ground #E0ECFF  ink #1E3A8A  line #C7D8FA  swatch #2563EB
type.online     ground #DCFCE7  ink #14532D  line #BBF0CD  swatch #16A34A

status.new             dot #DC2626  ground #FEF2F2  ink #991B1B
status.accepted        dot #2563EB  ground #EFF6FF  ink #1E40AF
status.cooking         dot #D97706  ground #FFFBEB  ink #92400E
status.ready           dot #16A34A  ground #F0FDF4  ink #166534
status.outForDelivery  dot #0D9488  ground #F0FDFA  ink #115E59

order.lateLine  #F5B8B0   the border of a row that is past its promised time
```

Collection is a takeaway: `fulfilment: TAKEAWAY` renders as TAKEAWAY. An
online collection order is ONLINE (its channel), a delivery is DELIVERY. A
`PAID` order that nobody has accepted yet is a *new* order for the counter and
takes the `new` tint. Consumed as utilities (`bg-type-dine-in`,
`text-type-dine-in-fg`, `border-type-dine-in-line`, `bg-status-new-dot` …),
never as hex.

---

## 6. Motion

Full rules in `motion.md`. The short version:

- Durations: 120ms micro, 200ms standard, 320ms entrance, 400ms+ hero only.
- Easing: `cubic-bezier(0.2, 0, 0, 1)` standard, spring only where it adds
  tactility (add-to-cart, drawer).
- Exits are faster than entrances.
- **Nothing on the POS animates longer than 120ms.** A cashier taps 200 times
  an hour; a 300ms transition is a minute of waiting per shift.
- `prefers-reduced-motion: reduce` renders the final state immediately and
  stays fully functional (§7).

---

## 7. Interaction

Full rules in `interaction.md`. The short version:

- Touch targets: 44×44px minimum on the customer site, **56×56px on the POS**.
  Staff are moving fast with wet hands; the web minimum is not enough.
- 8px minimum gap between adjacent targets.
- `touch-action: manipulation` everywhere, to kill the 300ms tap delay.
- No hover-only interaction, anywhere. The POS is a touchscreen and the
  customer is on a phone — hover does not exist for either.
- Every interactive element has a visible focus ring. Never remove it.

---

## 8. Every state, every time

§56 lists eight states and they are all required:

```
default   loading   success   error
empty     disabled  offline   permission denied
```

A feature with only a happy path is not finished. `offline` and `permission
denied` are the two that get skipped — the POS has to say it is offline (§57),
and a hidden button is not authorization (§41).

---

## 9. Voice

Plain, confident, a little blunt. Short sentences. Say what the food is and how
it is made.

Never: "indulge in", "culinary experience", "delight your senses", exclamation
marks, or an em-dash where a full stop works.

Errors say what happened and what to do. §57: never make failure look like
success.

> Payment couldn't be confirmed. Your order has not been submitted.

> You're offline. New orders will sync when connection returns.

Full copy rules in `content.md`.

---

## 10. Currency

Every rupee figure renders through `formatINR` in `src/lib/money`. Nothing else
formats money. Grouping is Indian — ₹9,40,000, never ₹940,000. Paise show only
on unit costs (₹33.50 per portion); business-scale figures round to whole
rupees.

---

## 11. Before you build a component

§67, in order:

1. Search this repo's components.
2. Search shadcn.
3. Search 21st.dev only if the component is genuinely visual and complex.
4. Reuse or extend before creating.

Names say what the thing is: `ProductCard`, `KdsTicket`, `InsightCard`. Never
`Card1`, `NewCard`, `CardFinal2`.

A community component never defines the visual language. Convert it to these
tokens or do not use it.
