# Content and voice

BUILD-PLAN.md §58. Restaurant content lives in data, never hard-coded in JSX.

## Voice

Plain, confident, a little blunt. Short sentences. Say what the food is and how
it is made.

**Never:** "indulge in", "culinary experience", "delight your senses", "elevate
your", "a symphony of flavours", exclamation marks.

| Instead of | Write |
|---|---|
| "Indulge in our signature crispy chicken experience" | "Chicken, brined overnight. Fried to order." |
| "Oops! Something went wrong!" | "Payment couldn't be confirmed. Your order has not been submitted." |
| "Your cart is feeling lonely!" | "Nothing in your cart yet." |
| "Awesome! Order placed!" | "Order #1048 confirmed. Ready in about 20 minutes." |

The brand is confident, not loud. Confidence is short sentences and specific
detail, not capital letters and exclamation marks.

## Product copy

Every product carries the fields in §58: name, slug, description, short
description, price, images, category, tags, allergens, nutrition,
availability, modifier groups, SEO metadata.

Descriptions say what it is and how it is made. Two sentences, maximum. The
name does the selling; the description answers the one question a hungry person
actually has.

> **Crispy Chicken Burger**
> Boneless thigh, brined overnight, double-dredged. Slaw and burger sauce in a
> toasted potato bun.

Devanagari appears in menu descriptors only. Never in a headline. Wrap it in
`lang="hi"` so a screen reader does not read it with English phonetics.

## Errors

Say what happened, then what to do. Never blame the user, never say "oops",
never make failure look like success (§57).

| Situation | Copy |
|---|---|
| Payment failed | "Payment couldn't be confirmed. Your order has not been submitted." |
| POS offline | "You're offline. New orders will sync when connection returns." |
| AI unreachable | "I can't reach the ordering assistant right now. You can continue ordering normally." |
| Item unavailable | "Sold out for today." |
| Missing data for AI | "I can't confirm that from the restaurant's current menu data." |

That last one is §33 as a sentence. When the model does not have grounded data,
this is what it says — it does not estimate, and it does not apologise at
length.

## Empty states

Say what would be here and how to get it. Never a blank panel and never a
joke.

| Screen | Copy |
|---|---|
| Cart | "Nothing in your cart yet." + Browse menu |
| Order history | "No orders yet." |
| KDS | "No tickets. Kitchen is clear." |
| Inventory | "No ingredients yet. Add one to start costing recipes." |
| Dashboard, no data | "No sales recorded today." — never ₹0 presented as if it were measured |

That last distinction matters. A dashboard showing ₹0 revenue looks like a bad
day. A dashboard saying no sales are recorded looks like missing data. They are
different facts and the owner needs to tell them apart.

## Numbers

All money through `formatINR`. Indian grouping — ₹9,40,000, never ₹940,000.
Paise only on unit costs. Whole rupees at business scale.

Percentages carry one decimal (27.5%) unless the extra digit is noise.

Times are relative where a person thinks relatively ("Ready in about 20
minutes"), absolute where they need to act on it ("Settles 14 Mar").

## Localisation

English-first, Devanagari for menu descriptors. The interface is not
translated; the food is. That matches how the audience actually reads — 18–30
in Ambala, ordering in English, recognising dishes in Hindi.
