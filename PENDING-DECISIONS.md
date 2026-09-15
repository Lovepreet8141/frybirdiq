# Pending decisions

Questions an autonomous session found, could not answer safely from the
repository alone, and deliberately left open. Each records what was done in the
meantime, so nothing is blocked while the decision waits.

Resolve one by making the change and deleting its section.

---

## 1. Should ADMIN be able to record an expense?

**Found:** 2026-09-15, while separating `finance.manage` from `finance.view`.

`ADMIN` is defined as every permission except `settings.manage` and
`finance.view`:

```ts
ADMIN: PERMISSIONS.filter((p) => p !== "settings.manage" && p !== "finance.view")
```

The `finance.view` exclusion is deliberate and documented — the payments ledger
is "OWNER and MANAGER only, the people who run the till day to day".

But financial *writes* — `recordExpense` and `setFoodCostTarget` — were gated on
that same `finance.view`. So the ledger-read decision was silently deciding who
could write into the books, and the result was upside down: **an ADMIN could not
record an expense, while a MANAGER could** — despite ADMIN holding
`orders.refund`, `menu.price`, `staff.manage` and `audit.view`.

**Done in the meantime:** `finance.manage` now exists and gates the writes.
It is granted to OWNER and MANAGER — exactly the roles that could write before —
and explicitly excluded from ADMIN. **Nobody's access changed.** A test asserts
that, role by role.

ADMIN is excluded by an explicit line rather than by the filter default, because
letting a new permission fall through would have handed ADMIN the ability to
write into the P&L as a side effect of a refactor. That is the wrong way for
anyone to gain that.

**The question:** was ADMIN's inability to record an expense intended, or was it
an accident of the two concepts sharing one permission?

- If **intended** — ADMIN administers the system but does not touch the books —
  then the current state is correct and this section can be deleted.
- If **accidental**, the fix is one line: drop `finance.manage` from ADMIN's
  exclusion list in `src/domain/permissions.ts`, and update the test named
  "does not let admin acquire a finance write through a filter default".

Not decided autonomously because it changes who can move money, which is a
business decision rather than an engineering one.

**Files:** `src/domain/permissions.ts`, `src/lib/iq/actions.ts`,
`src/domain/domain.test.ts`.
