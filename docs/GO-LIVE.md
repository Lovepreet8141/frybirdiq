# FRYBIRD: going live

For the owner, run once before the first real shift, and again if anything on
it is redone. It does not replace `docs/SHOP-RUNBOOK.md` (day-to-day) — it is
what has to be true before that runbook applies to real customers and real
money. Do each step on frybirdiq.tech; nothing here is tested on localhost.

Tick each box in order. A box you cannot tick is a reason to wait, not a
reason to skip it.

---

## 1. Printer setup and test print

1. On the tablet that will stand at the counter: install the **FRYBIRD POS**
   Android app and sign in with the owner or manager account.
2. Left menu **Admin → Hardware**. The tablet registers itself under
   **Devices** the moment the app opens — confirm it shows there, marked
   **Online**.
3. Tap **Set up printing** (or **Configure Printer** if one already exists).
4. Tap **Find printers on this network**, or type the printer's IP from its
   own self-test page. Port `9100`, `ESC/POS`, `80 mm` are already filled in
   for the POSIFLOW.
5. Tap **Test connection** — it should answer in under a second. Then tap
   **Test Print** and read the slip: shop name, no garbled characters, cut
   clean.
6. Leave **Default** and **Auto Print** switched on. From here every paid
   order prints on its own; if the printer is off, the order still goes
   through and the receipt can be retried from **Recent print jobs** on the
   same screen.
7. ☐ **Done when:** a test print came out clean, and a real POS test order
   (see §3) printed automatically with no one touching the printer screen.

If the shop has a second printer (kitchen copy), repeat from step 3 on the
device next to it — a printer belongs to the device connected to it, not to
the shop as a whole.

## 2. Staff invited, by role

Left menu **People → Staff**, use the **Invite staff** panel: email + role,
**Invite**. They get an email to set a password; access starts the moment
they accept — there is no separate "activate" step.

Invite in this order, so someone with the till and the kitchen is ready
before the doors open:

| Role | Invite for | What they see once signed in |
|---|---|---|
| **MANAGER** | Whoever runs a shift when the owner isn't there | **POS**, **Orders** (incl. refunds and discounts), **Kitchen**, **Deliveries** (incl. assigning them), the menu editor, **Inventory** and purchasing, **Customers**, **Promotions**, **Finance**, **Reports**. **Not** Staff invites and **not** Restaurant settings — those stay with OWNER/ADMIN |
| **CASHIER** | Whoever takes counter orders | **POS**, **Orders** (create, cancel, discount — no refunds), **Kitchen** (can mark tickets done), **Deliveries** (view/complete, not assign), **Customers** (view/edit), their own **Shifts**. No Finance, no Staff, no settings |
| **KITCHEN** | Whoever cooks | **Kitchen** display (all stations), **Orders** (read-only, so they can see what's coming), **Recipes** (view only), can **log waste**, their own **Shifts**. No POS order-taking, no money screens |
| **RIDER** | Anyone delivering | **Deliveries** only — their own, plus **Available** to take one — and their own **Shifts**. Nothing else; a rider cannot see another rider's deliveries or any order that isn't theirs |
| **INVENTORY** | Whoever manages stock and suppliers, if not the owner | **Inventory** (ingredients, purchase orders, suppliers, waste), **recipe editing**, menu view. No POS, no Orders, no Finance |
| **ADMIN** | Rare — a trusted second-in-command | Everything **OWNER** has except the **Restaurant** settings page, the **Finance** dashboard, **Promotions**, and IQ policy approval |

`People → Roles & permissions` shows the exact grid this table summarizes,
read live from the same rules the server enforces — if in doubt, check there
rather than this table.

☐ **Done when:** at least one MANAGER or CASHIER and one KITCHEN account has
accepted its invite and signed in once, on the device it will actually be
used from.

## 3. First till open

Only a MANAGER, ADMIN or OWNER sees this (finance access).

1. Count the float — the cash going into the drawer before selling anything.
   Write the number down on paper first.
2. Left menu **Finance → Payments**, scroll to the **Till** box.
3. Type the float into **Float put in the drawer (₹)**, tap **Open the
   till**. It now says **Till is open**.
4. Ring up one real, small **POS** order (dine-in or takeaway), pay it in
   cash, confirm the receipt prints (§1) and the kitchen ticket appears on
   the KDS (§4).
5. At the end of that test, walk through a close once, for real: **Finance →
   Payments → Till**, type what's actually in the drawer into **Cash counted
   in the drawer (₹)**, tap **Close the till**. It should show the counted
   amount, the expected amount and a difference of ₹0.
6. ☐ **Done when:** open → one real paid order → close has been run once,
   start to finish, with a ₹0 (or explained) difference.

If it says **A till is already open**, someone already did this — do not
open a second one; find out who and finish that till first.

## 4. First KDS shift

1. On the kitchen's own screen (tablet or monitor), sign in with the KITCHEN
   account and open **Operations → Kitchen** (`/app/kds`).
2. Confirm the tabs across the top match how this kitchen actually runs:
   **All tickets**, then one tab per station in use (**Fry**, **Assembly**,
   **Drinks** if the menu has any, **Pack**), then **Expo**. If a station
   tab is missing or extra, a MANAGER fixes it under **Restaurant** settings
   before the shift, not mid-service.
3. Run the same test order from §3 all the way through: it should appear on
   **All tickets**, the person on each station taps **Done** on their items,
   **Pack** if it needs bagging, and **Expo** shows **Mark ready** once every
   item is done.
4. Confirm a card turns amber, then red, as it ages — the "Order health"
   strip on **FRYBIRD IQ → Live operations** should show the same ticket in
   whichever colour the KDS shows.
5. ☐ **Done when:** one real order has gone New → Done (every station) →
   Packed (if applicable) → Ready, on the actual kitchen screen, watched
   start to finish by whoever runs the kitchen.

## 5. Rider install and location permission

Do this on the rider's own phone, not a spare.

1. Sign in at frybirdiq.tech/sign-in with the rider's account and open
   **Deliveries**.
2. A banner offers to install FRYBIRD as an app:
   - **Android/Chrome:** tap **Install**, accept the browser's own prompt.
     The banner then says "Installed. Find FRYBIRD on your home screen."
   - **iPhone (Safari):** the banner explains the manual steps — Share
     button, then **Add to Home Screen**. There is no automatic prompt on
     iOS; this is expected, not a bug.
3. Open FRYBIRD from the home-screen icon from now on, not the browser.
4. Take one real delivery (or a test one) through to **Send out**. The phone
   asks for **location permission** the moment the delivery goes
   OUT_FOR_DELIVERY — the rider must tap **Allow**, and **Allow while using
   the app** is enough (it does not need "Always").
5. Confirm on a second phone or the owner's phone, signed in as the
   customer, that `/order/[id]` shows the rider moving on the map — position
   only, never the rider's name or phone number.
6. ☐ **Done when:** the app is installed on the rider's home screen,
   location permission is granted, and one delivery showed live on the
   customer's tracking page.

If the rider declines location permission, delivery still works — the
customer's map just says "not available right now" instead of showing a
dot. It is not a blocker, just worse for that one delivery.

## 6. The paper fallback (when the internet drops)

Already written up, unchanged, in `docs/SHOP-RUNBOOK.md` §10 — everyone
working the counter should read it once before go-live, not discover it
during the first outage. In short: keep a phone hotspot ready, take paper
orders (items, name, phone, time) and the cash in a marked envelope if the
connection cannot be restored quickly, cook from the paper ticket, and enter
each paper order into **POS** exactly once when back online — check
**Orders** first if unsure whether one already came through the website.

☐ **Done when:** whoever runs a shift has read SHOP-RUNBOOK.md §10 and knows
where the hotspot phone is kept.

## 7. The five daily habits

These are what the **IQ readiness** score on the Command Center actually
measures — do them daily from day one and the score (and the numbers that
lean on it) stay honest.

1. **Close every order the same day.** An order left open past midnight
   counts against "Orders closed the same day." Check **Operations →
   Orders** before closing up.
2. **Record cash the same day it's taken.** Every completed cash order needs
   its cash recorded as received (counter cash at the till, rider door cash
   under **Finance → Payments → Till → Door cash riders are carrying**).
3. **Add a recipe for anything in the top 20 sellers.** **FRYBIRD IQ →
   Menu → Products**, open the product, fill in **Recipe**. Without it, food
   cost and margin for that item are simply unknown, not wrong — but unknown
   is still a gap the score will keep showing.
4. **Count stock once a week, per ingredient.** **Inventory → Ingredients →
   [ingredient] → Stock**, record what's actually on the shelf. A count that
   matches the system leaves no row on purpose — so the honest habit is
   counting on a schedule, not only when something looks off.
5. **Log waste as it happens**, not at week's end. **Inventory → Waste →
   Record waste** — spoiled, dropped or over-prepped stock that never sold.
   Skipping this is the single easiest way to make food cost look better
   than it is.

☐ **Done when:** the person responsible for each habit knows it's theirs and
where the screen is — not necessarily that a week of history exists yet.

---

Once every box above is ticked, FRYBIRD is ready for a real shift. Nothing
in this document deploys anything or changes a setting by itself — every
step is a person, on a real screen, doing a real thing once.
