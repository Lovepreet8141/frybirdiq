# FRYBIRD IQ: one shift, start to finish

For shop staff. Read it once, then keep it near the counter. Every step names the screen and the button, exactly as they appear.

**Rules for everyone**
- Sign in with **your own** login at frybirdiq.tech/sign-in. Never use someone else's, never share yours. Everything you do is recorded against your name.
- Money is only ever recorded on the screens below. Never type a price or a total yourself: the system works it out.
- If a button is grey, wait a second. Never tap it twice. Tapping twice is safe (it will not take the payment twice), but it wastes time.
- Not sure? Do not guess. Ask the owner.

---

## 1. Start of shift

1. Sign in.
2. In the left menu open **People > Shifts**. Tap **Clock in**.
3. Take a break: **Start break**, and when you are back **End break**. Leaving for the day: **Clock out**. (If you clock out during a break, the break ends by itself.)

## 2. Opening the till (owner or the person the owner names)

Only people with finance access see this. Today that is the owner.

1. Count the float (the cash you put in the drawer before selling). Write it down.
2. Left menu **Finance > Payments**. Scroll to the **Till** box.
3. Type the float in **Float put in the drawer (₹)**. Tap **Open the till**.
4. The box now says **Till is open**. From now on, every cash payment at the counter goes into this till.

If it says **A till is already open**, do not open another. Someone already did.

## 3. A customer at the counter (dine-in or takeaway)

1. Left menu **Operations > POS**. Stay on the **Order** tab.
2. Pick the type first: **Dine-in** or **Takeaway**. For dine-in you can pick the table.
3. Tap the items. If an item has options (size, pieces, sauce), choose them, then add.
4. Check the list and the total with the customer. Fix mistakes here, before you charge.
5. Tap **Charge ₹…**. The payment sheet opens.
6. Type **Cash received**. The system shows the change to give back.
7. Tap **Confirm payment**. Give the change. Tap **Print receipt** if the customer wants it.
8. The order goes to the kitchen by itself.

If the screen says **Couldn't reach the server. Press Confirm again**, press **Confirm** once more. It is safe: the same order can never be taken twice.

The **Tables** tab shows which tables are busy.

## 4. Website orders (customers order on frybirdiq.tech)

1. Left menu **Operations > Orders**. Keep this screen open on the counter tablet. A **sound** plays for every new order. After opening the screen, tap **Enable sound** in the top bar once (the tablet will not make a sound until you do); **Test alarm** plays it.
2. Each order is a card. The button on the card is always the next step:
   - **Accept** (we will make it)
   - **Start cooking**
   - **Mark ready**
   - **Send out** (delivery orders) or **Complete** (collection orders, when the customer has collected)
   - **Delivered** (delivery orders, when the rider is back with the confirmation)
3. An order that says it is waiting for **online payment** cannot be accepted until the payment arrives. Wait. Do not cook it.
4. **Cash on collection:** when the customer collects and pays, tap **Take ₹…** on the card, then **Complete**.
5. **Delivery, cash on delivery:** the rider collects the money at the door (see section 7). Do **not** tap **Take** on a delivery order.
6. Use the printer icon on a card to print the kitchen ticket if you need paper.

Never cancel or refund an order yourself. Ask the owner.

## 5. Kitchen screens

Left menu **Operations > Kitchen**. The tabs across the top are the screens:

- **All tickets**: every open order, with its stage.
- **Fry**, **Assembly**, **Drinks** (only when the menu has drinks): one station's items only. Tap **Done** next to an item when you have finished it. Tapped by mistake: **Undo**.
- **Pack**: takeaway and delivery orders that are cooked and need packing. Tap **Packed** when the bag is sealed (with the sauces listed).
- **Expo**: the person at the pass. When every item of an order is done, the card says **Mark ready**. Tap it. The order is now Ready for the counter or the rider.

A card turns amber and then red when the order is taking longer than it should. Look at the red ones first.

## 6. Turning orders off for a while (rush, power cut, fryer down)

1. On the **POS** screen, top right, tap the banner **Shop is OPEN for orders**. (Or **Admin > Restaurant**, the Close shop box.)
2. Choose the reason and how long, and confirm. Website customers now see that we are closed. Orders already accepted continue.
3. To open again tap the banner **Shop is CLOSED for orders** and confirm.

Tell the owner when you close and why.

## 7. Riders

Left menu **Operations > Deliveries**.

1. **Available** lists ready deliveries nobody has taken. Tap **Take it** on one you will deliver. First tap wins: if someone was faster, it says so. Pick another.
2. You can hold **2** deliveries at once and take **6** per hour (the owner can change these). At the limit, the button refuses: finish or **Release** one first.
3. **Yours** shows the details you need (address, phone, what to collect). Only you see them. Do not photograph or copy them.
4. Changed your mind and the food is still at the shop (**Ready**)? Tap **Release**. Once you have left with it, you cannot release: use **Couldn't deliver**.
5. At the door:
   - Already paid online: tap **Delivered**.
   - Cash on delivery: take the exact amount, then tap **Delivered · took ₹…**. Keep that cash separate. It goes to the till in section 9.
6. Customer not there, wrong address, refused: tap **Couldn't deliver**, write the reason. You cannot mark it failed if money was already taken.

## 8. Refunds

Only the owner refunds. If a customer wants money back: tell them the owner will decide, write down the order number and the reason. If a cash refund is approved and a rider is still carrying that order's cash, the owner follows the steps in `docs/DEPLOY.md`, section 13.

## 9. End of shift: rider cash, then close the till

Do these in order.

1. **Riders hand over first.** Finance > Payments > **Till** box, **Door cash riders are carrying**. For each rider you see how much they owe.
   - Count the cash the rider gives you, in front of them.
   - Type it in **Cash handed over (₹)** and tap **Receive it**.
   - A rider cannot receive their own cash: someone else must do it.
   - If it is short or over, the system records the difference against the rider. That is normal, it just has to be true.
2. **Count the drawer** with nobody looking at the screen. Everything in it: float, counter cash and the riders' cash you just received. Write the total.
3. In the **Till** box type it in **Cash counted in the drawer (₹)**. Tap **Close the till**. The system does not show what it expects until after you close, so the count is honest.
4. It then says **Counted, expected, and the difference**. A small difference happens. A big one: do not recount to "fix" it. Write down what happened during the day and tell the owner.
5. Hand the cash to the owner, or put it where the owner has told you.

Then: **People > Shifts > Clock out**.

## 10. When the internet drops

First: **website orders keep arriving** (the website is not in the shop), but **your screens cannot see them** until you are back online. Keep a phone with mobile data ready as a hotspot for the tablet.

1. **Connect the tablet to the phone hotspot.** This fixes most problems. Reload the page.
2. Screens that stop working offline: **POS** (it says "You're offline. New items can't be priced until connection returns"), **Orders**, **Kitchen**, **Deliveries**, **Shifts**. Do not trust a screen that has not updated.
3. If you cannot get back online quickly:
   - Take the customer's order on paper: items, name, phone, time. Take the cash.
   - Put the cash in an envelope marked with the paper order numbers. Do not put it in the drawer count yet.
   - Cook from the paper. The kitchen works from paper tickets.
4. **When the internet is back:**
   - Open **Orders** first and look for anything that arrived from the website meanwhile.
   - Enter each paper order in **POS** one by one, and tick it off on the paper as you go. **Enter each only once.** If you are unsure whether it went through, look in **Orders** before entering it again.
   - Only after all paper orders are entered, close the till (section 9).
5. Tell the owner the time it dropped and the time it came back.

If the internet is down and the website orders are piling up that you cannot see, ask the owner to switch orders off from their phone (section 6).

## 11. Who to call

The owner, for: refunds, cancelled orders, a till difference you cannot explain, a rider dispute, anything that looks wrong on the screen, or anything you are not sure about.
