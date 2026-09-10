# FRYBIRD IQ — ULTIMATE BUILD PLAN
## AI-Native Restaurant Ordering + Web POS + KDS + Inventory + Intelligence

> **Product goal:** Build one premium, production-grade web platform that combines a high-conversion restaurant website, custom online ordering, a touchscreen-first restaurant POS, kitchen operations, inventory, food-cost intelligence, loyalty, analytics, and an AI layer — without locking the business into a third-party ordering storefront.
>
> **Core philosophy:** The UI should feel like a world-class food brand. The engineering should behave like serious commerce/POS software.

---

# 1. THE PRODUCT

FRYBIRD IQ is a unified restaurant operating platform.

It should start as a **customer ordering website + restaurant web POS**, but the architecture must already support:

- Customer website
- Online ordering
- Restaurant POS
- Kitchen Display System
- Payments
- Tables
- Menu management
- Modifiers and combos
- Customers
- Loyalty
- Inventory
- Recipes
- Food costing
- Waste
- Purchasing
- Staff
- Multi-location
- Analytics
- AI concierge
- AI recommendations
- AI restaurant intelligence
- Integrations

The user sees one brand.

Underneath is one shared data model.

```text
                         FRYBIRD IQ
                              |
        +---------------------+---------------------+
        |                     |                     |
     CUSTOMER              RESTAURANT             OWNER
        |                     |                     |
     WEBSITE               WEB POS              IQ DASHBOARD
        |                     |                     |
     AI ORDERING            KDS                  ANALYTICS
        |                     |                     |
        +---------------------+---------------------+
                              |
                        FRYBIRD CORE
                              |
     +------------------------+------------------------+
     |            |           |          |             |
   ORDERS      PAYMENTS    MENU      INVENTORY      CUSTOMERS
     |            |           |          |             |
     +------------+-----------+----------+-------------+
                              |
                          EVENT BUS
                              |
                         FRYBIRD AI
```

---

# 2. EXPERIENCE PRINCIPLES

FRYBIRD must not look like a generic restaurant template or generic SaaS dashboard.

## Customer feeling

**Fast. Premium. Hungry. Confident. Fun.**

The visitor should feel:

> "This restaurant is modern and knows what it is doing."

Not:

> "This is an AI-generated restaurant template."

## Restaurant staff feeling

**Fast. Obvious. Touch-friendly. Reliable.**

A staff member should not need training to understand where to tap.

## Owner feeling

**Control. Clarity. Intelligence.**

The owner should understand what is happening without manually interpreting 20 charts.

---

# 3. TECHNOLOGY STACK

Use modern, stable technology. Do not chase a new library merely because it is new.

## Web application

- Next.js App Router
- React
- TypeScript
- Tailwind CSS
- shadcn/ui
- Base UI primitives for new shadcn projects unless there is a reason to use Radix
- Motion for React
- Lucide icons

Next.js App Router provides Server Components, Suspense, Server Functions and modern client/server navigation primitives. React's current major release is React 19.2.

## 3D

Use:

- Three.js
- React Three Fiber
- Drei

3D should be used selectively:

- premium hero object
- product/brand visual
- interactive campaign sections
- seasonal visual experience

Do NOT use 3D for:
- the entire menu
- checkout
- POS
- data tables
- every card

The 3D layer must be progressive-enhanced and disposable: the product must still work perfectly if WebGL is unavailable.

## Backend

Recommended first architecture:

- Next.js server-side application
- Supabase Postgres
- Supabase Auth
- Supabase Storage
- Supabase Realtime

Supabase provides a full Postgres database with Auth, Storage and Realtime around it. Realtime can subscribe to Postgres changes and broadcast low-latency updates.

## Data access

Use a dedicated server/data layer.

Suggested:

```text
src/lib/
├── db/
├── repositories/
├── services/
├── validation/
├── auth/
├── permissions/
└── events/
```

Do not let UI components directly query arbitrary database tables.

## Validation

Use Zod for:
- forms
- API payloads
- webhook payloads
- tool arguments
- server actions
- environment configuration

## Client data/cache

Use a server-first model.

Add TanStack Query only where it provides real value for:
- interactive POS queries
- background refetching
- optimistic mutations
- offline synchronization
- high-frequency operational data

Do not turn the entire website into a client-side SPA.

## Offline POS

The POS must be designed as **offline-capable from day one**.

Use:
- Service Worker/PWA
- IndexedDB
- Dexie or an equivalent lightweight IndexedDB layer
- local command/event queue
- idempotency keys
- background synchronization when connection returns

The POS must never lose an order because Wi-Fi drops.

## Payments

Use a provider abstraction.

For India, design the initial online payment integration around a provider such as Razorpay.

Never couple checkout/business logic directly to one provider.

```text
PaymentProvider
├── createOrder()
├── initializePayment()
├── verifyPayment()
├── capturePayment()
├── refundPayment()
└── handleWebhook()
```

For POS card terminals, keep a separate terminal/payment adapter because physical-terminal capabilities depend on the selected hardware/provider.

## Email/SMS/WhatsApp

Create provider interfaces:

```text
NotificationProvider
├── sendEmail()
├── sendSms()
└── sendWhatsapp()
```

Do not hard-code a communication vendor into order business logic.

---

# 4. DESIGN TECHNOLOGY STRATEGY

## UI UX Pro Max

Use UI UX Pro Max as the design reasoning layer.

Create and commit:

```text
design-system/
├── MASTER.md
├── tokens.json
├── content.md
├── motion.md
├── 3d.md
├── accessibility.md
└── pages/
    ├── home.md
    ├── menu.md
    ├── product.md
    ├── cart.md
    ├── checkout.md
    ├── tracking.md
    ├── pos.md
    ├── kds.md
    ├── inventory.md
    ├── analytics.md
    └── ai.md
```

The design system is source-of-truth.

UI UX Pro Max should be installed using its current official CLI/skill workflow for Claude.

## 21st.dev

Use 21st.dev as an inspiration/component source.

Rules:

1. Search before building complex visual components.
2. Prefer components that fit React + Tailwind + shadcn.
3. Inspect source before importing.
4. Remove unused dependencies.
5. Convert the component to FRYBIRD design tokens.
6. Ensure accessibility.
7. Ensure mobile behavior.
8. Ensure performance.
9. Do not allow a community component to define the visual language.

21st.dev is not the FRYBIRD design system.

## shadcn/ui

Use shadcn because the component source lives in the project and is intentionally customizable.

Prefer:
- shadcn components
- Base UI primitives where appropriate
- custom FRYBIRD wrappers
- consistent tokens

Do not install five separate UI libraries.

---

# 5. FRYBIRD DESIGN LANGUAGE

## Visual direction

Use a sophisticated restaurant-brand aesthetic with a technology layer.

Possible visual vocabulary:

- warm food photography
- strong typography
- premium dark/light contrast
- restrained expressive accent color
- tactile cards
- subtle grain/noise
- sharp product imagery
- oversized editorial moments
- micro-interactions
- cinematic but lightweight motion
- selective 3D

Avoid:
- generic glassmorphism
- excessive translucent panels
- gradient-everywhere
- huge text on every section
- rainbow gradients
- excessive rounded cards
- random neon UI
- fake AI "glow" on every component
- motion that slows ordering

---

# 6. BRAND SYSTEM

Define before coding screens.

## Tokens

Create tokens for:

```text
color
background
foreground
surface
surface-elevated
surface-muted
border
primary
secondary
accent
success
warning
destructive

font-family
font-size
font-weight
line-height
letter-spacing

radius
spacing
shadow
blur
z-index
motion-duration
motion-easing
```

Never hard-code brand colors throughout JSX.

## Typography

Use a premium variable font system.

Have distinct hierarchy:

- Display
- H1
- H2
- H3
- Body Large
- Body
- Small
- Caption
- Label
- Price
- KPI

Numbers and prices should have a dedicated style.

---

# 7. MOTION SYSTEM

Use Motion for React.

Create reusable primitives:

```text
MotionReveal
MotionStagger
MotionFade
MotionScale
MotionSlide
MotionPress
MotionDrawer
MotionModal
MotionNumber
MotionStatus
MotionPageTransition
```

## Motion rules

### Add to cart

- immediate button feedback
- optional product-to-cart transition
- cart count updates naturally

### Dialog

- opacity + scale
- short duration
- spring only where it improves tactile feel

### Menu

- subtle category transitions

### Order tracking

Status changes should have meaningful transitions.

### AI

Use:
- streaming text
- typing/processing state
- tool execution indicator where useful
- result transitions

## Accessibility

Respect:

```css
@media (prefers-reduced-motion: reduce)
```

Reduced motion must remain fully functional.

---

# 8. 3D SYSTEM

3D is an enhancement, not the foundation.

## Hero

Potential experience:

```text
FRYBIRD
CRISPY.
BOLD.
HOT.

[ORDER NOW]

                rotating 3D brand/product object
```

## Product 3D

Use sparingly and only when assets justify it.

Prefer:
- GLB/GLTF
- compressed geometry
- compressed textures
- DRACO/Meshopt where appropriate
- lazy loading
- poster/fallback image

## Performance rules

- do not load Three.js on pages that do not need it
- dynamically import 3D components
- load after critical content
- use a static poster for weak devices
- respect reduced motion
- never block checkout on WebGL

---

# 9. WEBSITE INFORMATION ARCHITECTURE

```text
/
├── /menu
├── /menu/[category]
├── /item/[slug]
├── /search
├── /cart
├── /checkout
├── /order/[id]
├── /account
├── /account/orders
├── /account/profile
├── /rewards
├── /locations
├── /about
├── /faq
└── /contact
```

Restaurant portal:

```text
/app
├── /pos
├── /orders
├── /kitchen
├── /tables
├── /menu
├── /customers
├── /inventory
├── /recipes
├── /food-cost
├── /waste
├── /purchasing
├── /staff
├── /analytics
├── /ai
├── /settings
└── /integrations
```

Use route-level authorization.

---

# 10. HOMEPAGE

The home page is a conversion surface, not a portfolio piece.

## Section architecture

### Hero

Primary goal:

**Order**

Include:
- product/brand visual
- concise value proposition
- Order Now
- View Menu

Optional 3D visual on desktop.

### Signature products

Use real product data.

### Category navigation

Quick entry to:
- chicken
- burgers
- wings
- combos
- sides
- drinks

### Interactive product moment

Let customers discover/customize an item.

### Brand story

Keep it memorable.

### AI Concierge

Example:

> "Tell me what you're craving."

Quick prompts:
- Something spicy
- High protein
- Under €15
- For 2 people
- Best seller

### Social proof

Real ratings/reviews only.

### Locations

Searchable locator.

### Final CTA

Order again.

---

# 11. MENU ENGINE

The menu must be fast enough for real ordering.

## Features

- category navigation
- search
- filters
- dietary labels
- spice level
- allergens
- availability
- product recommendations
- combo support
- modifiers
- dynamic pricing where permitted

## Product card

Include:

- image
- name
- description
- price
- tags
- quick add
- customization indicator

Avoid information overload.

---

# 12. PRODUCT CUSTOMIZATION ENGINE

Do not hard-code modifiers into each product component.

Model them.

```text
Product
  |
  +-- Modifier Group
        |
        +-- Modifier
        +-- Modifier
        +-- Modifier
```

Support:

- required selection
- optional selection
- min quantity
- max quantity
- price delta
- availability
- default selection

Example:

```text
6PC BUCKET

Choose pieces
[6 Wings]
[3 Wings + 3 Tenders]

Choose sauce
[BBQ]
[HOT]
[GARLIC]

Add side
[Fries +€2]
[Coleslaw +€2]
```

All calculations happen server-side.

---

# 13. CART

Cart must be interactive without becoming annoying.

Features:

- quantity update
- remove
- edit customization
- special instructions
- promo code
- upsells
- order mode
- delivery fee
- taxes
- total

Never trust the client for totals.

Server recalculates.

---

# 14. SMART UPSELL ENGINE

Create rule-based recommendations first.

Examples:

```text
burger → fries
bucket → drinks
wings → sauce
family order → group bundle
```

Then AI can personalize.

AI must not invent prices/products.

---

# 15. CHECKOUT

Checkout should be:

```text
Cart
 ↓
Pickup or Delivery
 ↓
Address / Contact
 ↓
Time
 ↓
Payment
 ↓
Confirmation
```

Support:
- guest checkout
- saved address
- customer account
- pickup
- delivery
- scheduled ordering if supported
- promo codes
- payment retry

Do not create unnecessary checkout steps.

---

# 16. ORDER ENGINE

Use explicit state transitions.

```text
DRAFT
↓
PENDING_PAYMENT
↓
PAID
↓
ACCEPTED
↓
PREPARING
↓
READY
↓
OUT_FOR_DELIVERY
↓
COMPLETED
```

Terminal:

```text
CANCELLED
FAILED
REFUNDED
```

The server owns valid transitions.

---

# 17. IDEMPOTENCY

Every important mutation needs an idempotency strategy.

Examples:

```text
createOrder
createPayment
capturePayment
refundPayment
sendKitchenTicket
```

Do not create duplicate orders because a mobile browser retries a request.

Store:

```text
idempotency_key
request_id
created_at
response_snapshot
```

---

# 18. REAL-TIME ARCHITECTURE

Use realtime for operational state.

Examples:

```text
Customer
  ← order status

POS
  ← new online order

KDS
  ← accepted order

Dashboard
  ← order/revenue updates

Inventory
  ← stock movement
```

Prefer event-driven state changes rather than constant polling.

---

# 19. WEB POS

The POS lives inside the web platform.

Recommended route:

```text
/app/pos
```

The UI must be optimized for:
- iPad
- touchscreen laptops
- desktop
- Android tablets

## POS layout

```text
┌─────────────────────────────────────────────────────────┐
│ FRYBIRD IQ        DINE-IN  TAKEAWAY  DELIVERY   €...   │
├─────────────┬─────────────────────────────┬─────────────┤
│ CATEGORIES  │ PRODUCTS                    │ ORDER       │
│             │                             │             │
│ Chicken     │ [Bucket] [Burger] [Wings]   │ 2 Burger    │
│ Burgers     │ [Combo]  [Fries]   [Coke]   │ 1 Fries     │
│ Wings       │                             │ 2 Coke      │
│ Combos      │                             │             │
│ Sides       │                             │ TOTAL        │
│ Drinks      │                             │ €31.40       │
│             │                             │              │
│             │                             │ [PAY]        │
└─────────────┴─────────────────────────────┴─────────────┘
```

## POS requirements

- large touch targets
- very low tap count
- keyboard shortcuts where useful
- barcode support if needed
- search
- quick add
- modifiers
- customer lookup
- discounts
- split payment
- partial payment
- cash
- card
- online payment
- refund
- receipt
- order notes
- table assignment

---

# 20. POS OFFLINE-FIRST DESIGN

This is non-negotiable.

The POS should maintain a local operational store.

```text
             SERVER
                ↑
         sync / conflict
                ↓
          LOCAL POS DB
                ↑
             UI/POS
```

When offline:

- staff can browse cached menu
- create orders
- add items
- calculate local totals
- queue mutations
- show offline status

When online:

- mutations sync
- server becomes authoritative
- conflicts are resolved explicitly

Use idempotency IDs for every mutation.

Never silently overwrite a newer server state.

---

# 21. KITCHEN DISPLAY SYSTEM

Route:

```text
/app/kitchen
```

Columns:

```text
NEW
PREPARING
READY
COMPLETED
```

Each ticket:

- order number
- elapsed time
- items
- modifiers
- notes
- source
- priority
- customer type

Timers:

```text
00:34
03:12
08:44
```

Add visual urgency without excessive color.

---

# 22. TABLE MANAGEMENT

Support:

- floor
- tables
- seats
- table state
- assigned orders
- merge tables
- transfer order
- split bill

Optional:

- visual floor map
- table timers

---

# 23. MENU ADMIN

Managers can manage:

```text
Categories
Products
Images
Descriptions
Prices
Modifiers
Combos
Availability
Schedules
Taxes
Allergens
Dietary tags
```

Changes must have audit records.

---

# 24. INVENTORY MODEL

Ingredients are first-class entities.

```text
Ingredient
SKU
Unit
Current stock
Reorder threshold
Supplier
Cost
```

Inventory movements:

```text
PURCHASE
SALE
WASTE
ADJUSTMENT
TRANSFER
RETURN
```

Never directly mutate stock without recording the movement.

---

# 25. RECIPE ENGINE

Example:

```text
Chicken Burger
  ├── Chicken 150 g
  ├── Bun 1
  ├── Sauce 25 g
  ├── Cheese 1 slice
  └── Packaging 1
```

Sale creates theoretical consumption.

```text
1 Chicken Burger
→ -150g chicken
→ -1 bun
→ -25g sauce
→ -1 cheese
→ -1 packaging
```

---

# 26. FOOD COST

Calculate:

```text
Ingredient cost
+ packaging
+ recipe components
= theoretical cost
```

Then:

```text
Food Cost %
=
food cost / net sales × 100
```

All monetary arithmetic uses integer minor units or decimal-safe arithmetic.

Never use binary floating point for final financial calculations.

---

# 27. WASTE

Waste entries:

```text
ingredient
quantity
unit
reason
employee
location
time
cost
```

Reasons:

- expired
- overproduction
- preparation waste
- damaged
- customer return
- quality issue

Then expose:

**Waste € today**

**Waste % of sales**

**Top waste ingredients**

---

# 28. PURCHASING

Future module:

```text
Supplier
Purchase Order
Receiving
Invoice
Cost history
```

The system should eventually forecast:

> "Based on recent sales, Friday demand and current stock, you may need 18 kg of chicken before tomorrow evening."

This is an AI-supported recommendation, not an automatic purchase.

---

# 29. CUSTOMER SYSTEM

Customer profile:

```text
customer
orders
favorites
addresses
preferences
loyalty
consent
communication settings
```

Use customer identity carefully.

Do not store unnecessary sensitive data.

---

# 30. LOYALTY

Support:

- points
- rewards
- tiers
- promotions
- referral codes
- birthday rewards only where legally/ethically appropriate and consented

Avoid dark-pattern loyalty.

---

# 31. AI — FRYBIRD CONCIERGE

AI should be a first-class product feature.

User:

> "I want something spicy under €15 for two people."

System:

1. understand intent
2. search structured menu
3. filter availability
4. calculate actual current price
5. rank options
6. explain recommendation
7. offer add-to-cart

Example:

> "For two people, I'd pick the 6pc Hot Wings + Fries and two drinks. It stays under your €15 per-person target."

Buttons:

[Add to Cart]

[See Alternatives]

[Make It More Spicy]

---

# 32. AI TOOL ARCHITECTURE

Do not let the model directly change database records.

Use server-side tools:

```text
searchMenu()
getProduct()
getCategory()
getAvailability()
getCurrentPrice()
getDeliveryEstimate()
getCustomerHistory()
recommendItems()
addToCart()
updateCart()
removeFromCart()
calculateCart()
```

Each tool:

- validates arguments
- authorizes caller
- queries trusted data
- logs execution
- returns structured results

For mutations:

```text
LLM
 ↓
tool call
 ↓
schema validation
 ↓
business service
 ↓
authorization
 ↓
database
 ↓
result
```

---

# 33. AI GUARDRAILS

Never invent:

- prices
- products
- availability
- allergens
- opening hours
- promotions
- order status
- delivery fees

Use structured restaurant data as the source of truth.

Allergen responses must be grounded in restaurant-managed allergen data.

If data is missing:

> "I can't confirm that from the restaurant's current menu data."

---

# 34. NATURAL-LANGUAGE MENU SEARCH

Support:

> "crispy chicken with cheese"

> "something not too spicy"

> "best thing under €10"

> "food for 4 people"

> "high protein"

Use structured filters first.

Use semantic ranking where keyword search is insufficient.

Do not use an LLM for every simple search.

---

# 35. AI OWNER COPILOT

Owner dashboard includes:

```text
Ask FRYBIRD IQ

"Why was sales lower yesterday?"

"Which item has the best margin?"

"Why did food cost increase?"

"What should I prep more of tomorrow?"

"Which items should we consider removing?"

"How much chicken should we order?"
```

Responses should show:

- answer
- supporting metrics
- period
- confidence/limitations
- links to the underlying report

AI must not pretend a recommendation is a proven fact.

---

# 36. AI INSIGHTS ENGINE

Use deterministic analytics before LLM generation.

Example pipeline:

```text
Raw events
  ↓
Analytics aggregates
  ↓
Rules/anomaly detection
  ↓
Candidate insights
  ↓
LLM explanation
  ↓
Owner-friendly insight
```

Example:

```text
⚠ Food cost variance

Chicken usage is 8.4% above theoretical usage
for the current sales mix.

The difference is approximately €11.34.

[View inventory variance]
```

The number comes from calculations.

AI explains it.

---

# 37. FORECASTING

Future capability:

- sales forecasting
- order-volume forecasting
- item demand
- ingredient demand
- staffing demand

Start with transparent baseline models before complex ML.

Use:
- moving averages
- day-of-week seasonality
- recent trend
- promotions/events
- weather only where legitimately useful and available

Do not promise precise forecasts.

---

# 38. OWNER DASHBOARD

Default dashboard:

```text
TODAY

Revenue                €2,840
Orders                    127
Average Order          €22.36
Food Cost              27.5%
Estimated Gross Profit  €2,058

----------------------------------

SALES
[chart]

ORDERS
[chart]

TOP PRODUCTS
[ranking]

INVENTORY ALERTS
[alerts]

AI INSIGHTS
[insights]
```

The page should answer:

**What happened?**

**Why?**

**What should I do?**

---

# 39. ANALYTICS ENGINE

Track business events separately from operational records.

Events:

```text
page_view
menu_view
search
product_view
add_to_cart
remove_from_cart
checkout_started
payment_started
payment_success
payment_failed
order_created
order_accepted
order_completed
refund_created
ai_opened
ai_recommendation
ai_add_to_cart
```

Business metrics should come from authoritative transaction data, not only analytics events.

---

# 40. REPORTING

Reports:

- daily sales
- weekly sales
- monthly sales
- orders
- AOV
- products
- category performance
- discounts
- refunds
- payment methods
- food cost
- inventory variance
- waste
- customers
- repeat rate

---

# 41. ROLE-BASED ACCESS

Roles:

```text
OWNER
ADMIN
MANAGER
CASHIER
KITCHEN
INVENTORY
ANALYST
```

Permissions should be granular.

Example:

```text
orders.view
orders.create
orders.refund
menu.edit
inventory.adjust
analytics.view
staff.manage
settings.manage
```

Never rely only on hiding UI buttons.

Authorization must happen server-side.

---

# 42. MULTI-LOCATION READY

Data model should allow:

```text
organization
  ├── location
  ├── location
  └── location
```

Every operational table should have the correct tenant/location relationship.

Do not retrofit multi-location after the single-store schema is already deeply coupled.

---

# 43. ORDER SOURCES

Every order should have a source:

```text
WEBSITE
POS
PHONE
KIOSK
DELIVERY_PARTNER
IMPORT
```

This enables:

- channel comparison
- commission analysis
- direct-order share
- source-specific metrics

---

# 44. INTEGRATION LAYER

Create adapters:

```text
integrations/
├── payments/
├── delivery/
├── accounting/
├── messaging/
├── loyalty/
└── pos/
```

Never scatter provider-specific API calls through the application.

---

# 45. API / WEBHOOK RULES

All webhooks:

- verify signature
- validate schema
- deduplicate
- persist receipt
- process asynchronously where appropriate
- log failures
- retry safely

Webhook events must be idempotent.

---

# 46. SECURITY

Required:

- server-side authorization
- input validation
- secure sessions/cookies
- webhook signatures
- rate limits
- audit logs
- secret management
- least privilege
- database row-level security where appropriate
- no secrets in client bundles
- no trust in client prices/totals/roles
- safe file upload validation

Never expose service-role/database credentials in the browser.

---

# 47. PWA

Customer website:

- installable where useful
- fast loading
- offline shell for non-transactional content where appropriate

POS:

- installable
- offline capable
- fullscreen
- touch optimized

Do not advertise the POS as "offline" until the offline sync behavior is tested under real network interruption.

---

# 48. PERFORMANCE TARGETS

Set explicit budgets.

Target:

- excellent Core Web Vitals
- CLS < 0.1
- fast LCP on mobile
- minimal blocking JavaScript
- optimized images
- no unnecessary hydration

## Rules

- server-render stable content
- dynamic import heavy modules
- lazy-load 3D
- responsive image sizes
- AVIF/WebP where appropriate
- reserve image dimensions
- avoid huge client bundles
- do not ship dashboard code to customer pages

---

# 49. CODE SPLITTING

Customer site should not download:

- POS
- KDS
- inventory
- analytics
- Three.js

unless required.

Use route-level and component-level splitting.

---

# 50. DATABASE CORE

Initial entities:

```text
organizations
locations
users
roles
permissions
staff
customers
addresses

categories
products
product_variants
modifier_groups
modifiers
combo_products
tax_rules

orders
order_items
order_item_modifiers
order_events
payments
refunds

ingredients
recipes
recipe_items
inventory_items
inventory_movements
waste_entries

loyalty_accounts
loyalty_transactions
promotions
discounts

ai_conversations
ai_messages
ai_tool_calls

analytics_events
audit_logs

integrations
webhook_events
idempotency_keys
```

---

# 51. MONEY MODEL

Never rely on JavaScript floating point for financial truth.

Use:

```text
amount_minor: integer
currency: ISO currency code
```

Example:

```text
1490 EUR cents = €14.90
```

For calculations where tax/discount rules require decimal precision, use a decimal-safe server-side representation.

Persist historical price/tax snapshots on order records.

Changing today's menu price must never rewrite yesterday's order.

---

# 52. AUDIT LOGGING

Log critical operations:

```text
price_changed
menu_item_disabled
refund_created
inventory_adjusted
recipe_changed
staff_role_changed
discount_created
settings_changed
```

Audit entries:

```text
actor
action
entity
entity_id
before
after
timestamp
location
request_id
```

---

# 53. OBSERVABILITY

Production should have:

- structured logging
- request IDs
- error monitoring
- performance monitoring
- webhook monitoring
- payment monitoring
- sync monitoring

Operational dashboard should eventually show:

```text
Online
Payments healthy
Realtime healthy
POS sync healthy
KDS healthy
```

---

# 54. TESTING STRATEGY

## Unit

Test:
- totals
- tax
- discounts
- modifiers
- recipes
- food cost
- inventory consumption
- state transitions
- permissions

## Integration

Test:
- create order
- payment verification
- webhook handling
- order status
- inventory movement
- AI tool authorization

## E2E

Test:

```text
Customer
→ menu
→ customization
→ cart
→ checkout
→ payment
→ order confirmation

Restaurant
→ new order
→ accept
→ KDS
→ prepare
→ ready

Customer
→ status update
```

## POS offline E2E

Test:

```text
online
→ create order
→ disconnect network
→ create order
→ reconnect
→ sync
→ verify no duplicates
```

---

# 55. ACCESSIBILITY

Required:

- semantic HTML
- keyboard navigation
- visible focus
- accessible dialogs
- accessible form errors
- alt text
- contrast
- reduced motion
- touch targets ≥ 44 × 44 px where appropriate
- no hover-only interactions

Accessibility is especially important for POS because touchscreen and keyboard workflows must coexist.

---

# 56. UI STATE REQUIREMENTS

Every interactive feature needs:

```text
default
loading
success
error
empty
disabled
offline
permission denied
```

Do not build only the happy path.

---

# 57. ERROR HANDLING

Examples:

Payment:

> "Payment couldn't be confirmed. Your order has not been submitted."

POS network:

> "You're offline. New orders will sync when connection returns."

AI:

> "I can't reach the ordering assistant right now. You can continue ordering normally."

Never make failure look like success.

---

# 58. CONTENT SYSTEM

Restaurant content should live in data, not scattered hard-coded JSX.

Products should have:

```text
name
slug
description
short_description
price
images
category
tags
allergens
nutrition
availability
modifier_groups
seo_metadata
```

---

# 59. SEO

Implement:

- metadata
- canonical URLs
- sitemap
- robots
- Open Graph
- product structured data where appropriate
- restaurant structured data
- local business structured data where appropriate
- clean URLs

Every product page should have useful unique content.

---

# 60. IMAGE PIPELINE

Product images:

- consistent aspect ratio
- responsive sizes
- image compression
- AVIF/WebP
- lazy load below fold
- priority for hero content
- no layout shift

The CMS/image pipeline should preserve:
- alt text
- focal point
- crop
- image order

---

# 61. CUSTOMER ACCOUNT

Account pages:

```text
Profile
Orders
Saved addresses
Favorites
Rewards
Preferences
Communication settings
```

Do not force account creation before first order unless legally/business necessary.

---

# 62. ORDER TRACKING

Customer sees:

```text
ORDER #1048

✓ Order received
✓ Restaurant accepted
● Preparing
○ Ready
○ Completed
```

Optional:

- estimated ready time
- pickup location
- delivery status

Do not fake live location if the system does not actually have reliable data.

---

# 63. POS RECEIPTS

Support:
- digital receipt
- print receipt if connected
- email receipt
- tax information
- payment method
- order number

Hardware integrations should be abstracted.

---

# 64. PRINTING

Create:

```text
PrinterProvider
├── printReceipt()
├── printKitchenTicket()
└── getStatus()
```

Do not embed printer-specific logic throughout POS components.

---

# 65. CUSTOMER WEBSITE + POS SHARED DATA

Critical principle:

```text
              SHARED ORDER ENGINE
                     |
       +-------------+-------------+
       |             |             |
     WEBSITE        POS           KIOSK
       |             |             |
       +-------------+-------------+
                     |
                    KDS
```

A product created once should be available consistently across the supported interfaces.

---

# 66. DESIGN SYSTEM FILES

The final repository must contain:

```text
design-system/
├── MASTER.md
├── tokens.json
├── content.md
├── motion.md
├── 3d.md
├── accessibility.md
├── interaction.md
└── pages/
```

Every UI change must respect this hierarchy.

---

# 67. COMPONENT GOVERNANCE

Before creating a component:

1. Search existing component library.
2. Search shadcn.
3. Search 21st.dev when appropriate.
4. Search local components.
5. Reuse or extend before creating another component.

Naming:

```text
ProductCard
ProductQuickAdd
ProductCustomizer
CartItem
OrderCard
KdsTicket
InventoryTable
InsightCard
```

Avoid:

```text
Card1
NewCard
FancyCard
CardFinal
CardFinal2
```

---

# 68. VISUAL QA LOOP

For every major screen:

```text
Build
↓
Run app
↓
Render at mobile/tablet/desktop
↓
Inspect visual hierarchy
↓
Check console
↓
Check accessibility
↓
Check interaction
↓
Fix
↓
Repeat
```

AI coding agents must not assume visual correctness from source code.

---

# 69. CLAUDE DEVELOPMENT WORKFLOW

Claude must follow:

```text
READ
↓
INSPECT
↓
PLAN
↓
IMPLEMENT
↓
RUN
↓
TEST
↓
VISUAL REVIEW
↓
POLISH
```

Before touching an existing module, inspect it.

Do not rewrite working code simply because a cleaner-looking implementation is possible.

---

# 70. CLAUDE NON-NEGOTIABLES

Claude must:

1. Read BUILD-PLAN.md.
2. Read CLAUDE.md.
3. Read design-system/MASTER.md.
4. Read the target page spec.
5. Inspect existing components.
6. Reuse existing primitives.
7. Preserve the design system.
8. Use TypeScript.
9. Validate server/client boundaries.
10. Run lint.
11. Run tests.
12. Check responsive behavior.
13. Check accessibility.
14. Check reduced motion.
15. Check error/loading/empty states.
16. Never expose secrets.
17. Never trust client money values.
18. Never trust client authorization.
19. Never create duplicate mutations.
20. Never use mock data in a production path unless explicitly marked.

---

# 71. CLAUDE PROMPT STYLE

Bad:

> Build the most amazing restaurant website possible.

Good:

> Read BUILD-PLAN.md, CLAUDE.md, and design-system/MASTER.md. Inspect the existing architecture. Implement only the requested feature. Reuse existing primitives. Before coding, list files to change and any schema/API impact. After implementation run typecheck, lint and tests. Verify mobile, desktop, accessibility, loading/error/empty states and reduced motion.

---

# 72. REPOSITORY STRUCTURE

Recommended:

```text
FRYBIRD-IQ/
├── BUILD-PLAN.md
├── CLAUDE.md
├── README.md
├── package.json
├── .env.example
├── design-system/
│
├── apps/
│   ├── web/
│   └── maybe-admin/          # only if later justified
│
├── packages/
│   ├── ui/
│   ├── config/
│   ├── domain/
│   ├── validation/
│   └── types/
│
└── supabase/
    ├── migrations/
    ├── functions/
    └── seed/
```

For the first release, a simpler single-app Next.js repo is acceptable. Do not introduce a monorepo until the project actually benefits from it.

---

# 73. BUILD ORDER

## PHASE 0 — DESIGN + ARCHITECTURE

Build:

- repository
- design intelligence
- tokens
- typography
- component primitives
- motion system
- 3D rules
- security model
- database model
- route map

Deliverable:

**A boring functional shell with excellent foundations.**

---

## PHASE 1 — CUSTOMER WEBSITE

Build:

- header
- hero
- menu
- product cards
- product customization
- cart
- checkout
- confirmation
- order tracking

Goal:

**A real customer can place a real test order from beginning to end.**

---

## PHASE 2 — PAYMENT

Build:

- payment adapter
- server-side order creation
- payment verification
- webhook verification
- retry
- refunds

Goal:

**No fake "payment successful" logic.**

---

## PHASE 3 — REAL-TIME ORDERING

Build:

- order events
- realtime status
- restaurant incoming order notifications
- customer order tracking

---

## PHASE 4 — WEB POS

Build:

- POS shell
- product grid
- order builder
- modifiers
- customer lookup
- payment
- receipt
- order history
- discounts
- refunds

---

## PHASE 5 — OFFLINE POS

Build:

- PWA
- IndexedDB
- offline menu cache
- offline order queue
- sync engine
- idempotency
- conflict handling

---

## PHASE 6 — KDS

Build:

- ticket queue
- statuses
- timers
- priority
- sound/visual alerts
- completed history

---

## PHASE 7 — ADMIN

Build:

- menu management
- pricing
- availability
- modifiers
- categories
- staff
- settings

---

## PHASE 8 — INVENTORY

Build:

- ingredients
- recipes
- stock movements
- waste
- suppliers
- purchasing
- stock alerts

---

## PHASE 9 — FOOD COST

Build:

- recipe costing
- theoretical cost
- actual usage
- variance
- food-cost reporting
- product margin

---

## PHASE 10 — IQ ANALYTICS

Build:

- revenue
- orders
- AOV
- product performance
- food cost
- waste
- customer repeat rate
- channel performance

---

## PHASE 11 — AI

Build:

### Customer AI
- concierge
- semantic menu search
- recommendations
- cart assistance

### Owner AI
- insights
- variance explanations
- forecasting
- daily briefing
- natural-language analytics

---

# 74. V1 MVP DEFINITION

V1 is complete when this works:

```text
CUSTOMER
Website
 ↓
Browse
 ↓
Customize
 ↓
Cart
 ↓
Checkout
 ↓
Payment
 ↓
Order created
 ↓
Restaurant receives order
 ↓
POS accepts
 ↓
KDS receives
 ↓
Kitchen prepares
 ↓
Ready
 ↓
Customer sees status
```

And:

```text
STAFF
POS
 ↓
Create order
 ↓
Pay
 ↓
KDS
 ↓
Complete
```

---

# 75. WHAT MAKES FRYBIRD IQ DIFFERENT

Do not compete only on:

- billing
- receipts
- basic POS
- menu management

The differentiators should become:

### 1. Direct ordering
Restaurants own the customer experience.

### 2. Beautiful UX
Much better customer-facing interface than traditional restaurant software.

### 3. Fast web POS
Touch-first and keyboard-friendly.

### 4. Real-time operations
Website → POS → KDS → customer.

### 5. Food-cost intelligence
Actual vs theoretical usage.

### 6. AI
Useful, grounded and actionable.

### 7. Unified data
One system instead of disconnected tools.

### 8. Extensible integrations
Provider adapters instead of vendor lock-in.

---

# 76. ADVANCED FEATURES — AFTER CORE STABILITY

Do not build these before the core ordering/POS loop is reliable.

Possible additions:

- customer personalization
- recommendation engine
- semantic search
- AI menu assistant
- smart prep forecasting
- staffing forecasts
- demand forecasting
- loyalty
- subscriptions
- gift cards
- referrals
- digital receipts
- kiosk mode
- QR table ordering
- self-ordering
- delivery fleet tools
- multi-brand
- franchise controls
- accounting integrations
- advanced hardware integrations
- experimentation/A-B testing

---

# 77. AI UX RULES

AI should never cover the core ordering UI.

The customer can always:

```text
Browse menu normally
OR
Ask AI
```

Do not force an AI chat flow.

AI recommendations should be actionable:

```text
[Add]
[Customize]
[Compare]
```

not just paragraphs.

---

# 78. EXPERIMENTATION

Build the ability to test:

- hero CTA copy
- product ordering
- upsell placement
- product images
- category order
- promotion messaging

Use feature flags.

Do not A/B test payment or compliance-critical behavior without careful validation.

---

# 79. FEATURE FLAGS

Create:

```text
feature_flags
feature_flag_rules
```

Use flags for:

- new AI features
- 3D hero
- new POS workflows
- new checkout
- beta integrations

This allows controlled releases.

---

# 80. RELEASE STRATEGY

Environments:

```text
development
staging
production
```

Every production deployment should run:

```text
typecheck
lint
unit tests
integration tests
build
smoke test
```

---

# 81. BACKUP / RECOVERY

Database:

- automated backups
- point-in-time recovery where available
- migration discipline

Critical operational events should be recoverable from database records.

Never treat the browser's local cache as the only copy of financial truth.

---

# 82. DATA RETENTION

Define retention policies for:

- order records
- payment metadata
- customer data
- analytics
- AI conversations
- audit logs

Only retain what is useful/required.

---

# 83. PRIVACY

Build privacy settings into the customer model.

Support:

- marketing consent
- analytics consent where applicable
- account deletion request
- communication preferences

AI memory must be explicit and controllable.

---

# 84. FINAL QUALITY BAR

FRYBIRD IQ should pass five tests.

## Test 1 — Customer

Can someone order in under a minute without confusion?

## Test 2 — Staff

Can a new cashier create an order without training?

## Test 3 — Kitchen

Can the kitchen immediately understand what to make?

## Test 4 — Owner

Can the owner understand today's business in under 30 seconds?

## Test 5 — AI

Does AI make decisions easier without making up facts?

If any answer is no, keep improving.

---

# 85. FIRST COMMAND TO CLAUDE

Use exactly this as the first serious build task:

> Read BUILD-PLAN.md completely.
>
> Do not build application features yet.
>
> First inspect the repository and report:
>
> 1. Current framework
> 2. Current dependencies
> 3. Existing routes
> 4. Existing components
> 5. Existing database
> 6. Authentication
> 7. Design system
> 8. Animation setup
> 9. Build tooling
> 10. Any architectural problems
>
> Then propose a precise FRYBIRD IQ implementation plan based on BUILD-PLAN.md.
>
> For UI/UX work, use the project's UI UX Pro Max skill and the FRYBIRD design-system files.
>
> Use shadcn/ui as the controlled component foundation, 21st.dev selectively for high-quality component patterns, Motion for React for animation, and React Three Fiber/Three.js only where 3D materially improves the experience.
>
> Do not install random libraries.
>
> Do not modify application code until the repository audit and implementation plan are complete.

---

# 86. SECOND COMMAND — DESIGN FOUNDATION

After the audit:

> Build only the FRYBIRD IQ design foundation.
>
> Read BUILD-PLAN.md, CLAUDE.md and design-system/MASTER.md.
>
> Establish:
> - brand tokens
> - typography
> - spacing
> - surface system
> - buttons
> - inputs
> - cards
> - dialogs
> - drawers
> - tabs
> - badges
> - navigation
> - loading states
> - error states
> - empty states
> - motion primitives
> - responsive rules
> - accessibility rules
>
> Configure Motion for React.
>
> Configure the shadcn/ui foundation.
>
> Do not build the homepage.
>
> Do not build POS.
>
> Do not build checkout.
>
> Do not create unnecessary components.
>
> Run typecheck, lint and tests when complete.

---

# 87. THIRD COMMAND — CUSTOMER VERTICAL SLICE

After the foundation:

> Build the first complete customer ordering slice:
>
> Homepage → Menu → Product → Customization → Cart → Checkout → Order Confirmation.
>
> Use real database-backed restaurant data.
>
> Use the FRYBIRD design system.
>
> Use Motion for purposeful interactions.
>
> Use 21st.dev only when the component materially improves the UX and adapt it to FRYBIRD.
>
> Do not add 3D to checkout.
>
> 3D may be used only in the hero if performance remains excellent.
>
> Every interactive state must have loading, error, empty and disabled behavior.
>
> Server-side validation and price calculation are mandatory.

---

# 88. ULTIMATE PRINCIPLE

**Do not optimize for the most impressive demo.**

Optimize for:

```text
REAL CUSTOMER
      ↓
REAL ORDER
      ↓
REAL PAYMENT
      ↓
REAL RESTAURANT
      ↓
REAL KITCHEN
      ↓
REAL DATA
      ↓
REAL INTELLIGENCE
```

The final experience can be spectacular.

But the foundation must be boringly reliable.

That is how FRYBIRD IQ becomes a real restaurant platform instead of another beautiful prototype.
