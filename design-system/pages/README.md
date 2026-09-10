# Page specs

One file per page, named for its route. A page spec **overrides `MASTER.md`
for that page and nowhere else**. It never restates Master — only the places
this page departs from it, and why.

Retrieval order when building a screen:

1. `design-system/MASTER.md`
2. `design-system/pages/<page>.md`, if it exists — its rules win
3. The component

BUILD-PLAN.md §66 lists the pages that will need one:

```
home  menu  product  cart  checkout  tracking
pos   kds   inventory  analytics  ai
```

None exist yet. They get written as each phase reaches them, not upfront —
a spec written six phases early is a guess, and a stale spec is worse than no
spec because someone will follow it.

## Shape

```markdown
# <Page>

## Departs from Master
What this page does differently, and the reason.

## Layout
Structure at 375 / 768 / 1440.

## States
default · loading · success · error · empty · disabled · offline · permission denied

## Motion
Only what differs from motion.md.

## Copy
Headings, empty state, error state — per content.md.
```
