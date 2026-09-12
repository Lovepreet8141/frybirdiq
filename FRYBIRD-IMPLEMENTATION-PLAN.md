# FRYBIRD Implementation Plan

Reads `FRYBIRD-REFERENCE-CATALOG.md`, `FRYBIRD-ADMIN-ARCHITECTURE.md`, `FRYBIRD-POS-ARCHITECTURE.md`, `FRYBIRD-COMPONENT-MIGRATION.md`. This document sequences the work and — per your instruction to only ask when a decision is genuinely consequential and can't be safely inferred — ends with the one question this audit surfaced.

## The tension this audit found, stated plainly

`BUILD-PLAN.md` §73 already specifies a build order, phase by phase, and `CLAUDE.md` states it twice: *"Follow BUILD-PLAN.md §73. Do not skip ahead."* Current phase is **4 — Web POS**. Phases 5–11 are Offline POS, KDS, Admin (menu/staff/settings), Inventory, Food Cost, IQ Analytics, AI — in that order, deliberately.

Your request for this pass asks for Inventory, Recipes, Staff/Shifts/Permissions, a full CRM, KDS ticket stations, and a complete Settings suite — phases 6, 7, 8, and pieces of 9/10 — built now, in one unified admin, "without stopping for trivial feature-by-feature approvals."

I don't think skipping five phases on a live restaurant's real codebase is a trivial feature-by-feature decision — it's the one this audit exists to surface, per your own instruction. Here's what I found that bears on it, and my recommendation.

### What's actually ready to build now, without skipping anything

- **POS table management.** Phase 4's own scope (Web POS) is unfinished — this is real, in-phase work, not a skip. The catalog identifies exactly what to adapt and the architecture doc specifies the schema. **Recommended: build this now.**
- **Menu Control Center gap-filling.** Several MENU items in the admin-architecture doc are marked PARTIAL, not missing — Publish Queue, Recipes, Product Cost, Margins already have real backend code (`lib/iq/costing.ts`, `lib/iq/profit.ts`, `product-recipe-section.tsx`, `app/iq/menu/review`) with thin or no dedicated UI. **Recommended: audit each PARTIAL item first — some may just need a nav entry, not new code — then fill genuine gaps only.** This is Phase 7 (Admin) work, but it's UI on top of Phase-4-adjacent code that already exists, not a five-phase jump.
- **The sidebar shell.** Structural, additive, doesn't touch business logic or skip a phase — it's a container that can hold LIVE items today and PLANNED items later without those items existing yet.

### What the catalog found genuinely well-prepared, but is still a phase skip

- **Inventory.** The schema is the best-prepared thing in this entire audit — 11 tables already migrated, covering suppliers through purchase orders. That's real infrastructure sitting idle. But it's Phase 8, two phases past current, and none of Phase 5 (Offline POS) or Phase 6 (KDS) exists yet. Building Inventory's UI now would mean the codebase has a fully-featured back-office inventory system before the POS can take an order offline or a kitchen has a ticket screen — a strange shape for a restaurant that's still opening its doors.
- **Staff/Shifts, full Customers/CRM, KDS, Settings suite.** All PLANNED, all real, none scheduled this soon by FRYBIRD's own plan.

### My recommendation

Build POS table management and the sidebar shell now (this pass, no further confirmation needed — see gates below). Audit and fill genuine PARTIAL gaps in Menu Control Center. Leave Inventory, Staff, full CRM, KDS, and the Settings suite as the architecture documents above (fully specified, ready to pick up), and build them in BUILD-PLAN's own order as you reach those phases — where this audit's catalog and component-migration doc will still be exactly this useful, since none of it goes stale.

**The question:** do you want me to proceed on that basis (table management + sidebar + Menu Control Center gap audit, now; everything else staged for its documented phase), or do you actually want Inventory/Staff/CRM/KDS/Settings built now regardless of the phase order? I'll act on whichever you choose, but I'm not going to silently pick "skip five phases on a live shop" for you.

---

## Phased plan (assuming the recommendation above)

### Phase A — Shell (low risk, foundational)
1. `src/components/staff/app-sidebar.tsx` — sidebar shell, LIVE items only, permission-gated identically to today's header.
2. Wire into `src/app/(app)/app/layout.tsx`, replacing the header nav row for non-POS/KDS routes.
3. Gates: `pnpm typecheck && pnpm lint && pnpm test`, `scripts/check-rsc-boundaries.sh`, contrast check (new nav surface).

### Phase B — POS table management
1. Migration: `tables` table, `orders.table_id`. `pnpm db:generate` + review the generated SQL by hand before `db:migrate` — this touches the live order schema.
2. `src/lib/repositories/tables.ts`.
3. Five components per `FRYBIRD-COMPONENT-MIGRATION.md`.
4. Wire into `/app/pos` as a second view alongside the product grid.
5. Gates: full suite, plus a real Playwright pass against a throwaway staff account (the pattern already established this session) — table assignment touches order state, worth the same rigor as the sign-out and dashboard work earlier.

### Phase C — Menu Control Center gap audit
1. Read `app/iq/menu/review`, `product-recipe-section.tsx`, `lib/iq/costing.ts`, `lib/iq/profit.ts` against what §8 of your brief actually asks for.
2. Report back: what's already satisfied, what's a genuine small gap, before writing any new component.

### Not this pass (documented, staged)
Inventory UI, Staff/Shifts, full Customers/CRM, KDS, Settings suite — per the recommendation above, pending your answer to the question.

## Safety, restated

No commit until a phase's gates pass. No deploy, no push, this pass — per your explicit instruction. Production data untouched; any live-data verification follows the pattern already used this session (a throwaway, real-schema test account, created and deleted, never fabricated business data).
