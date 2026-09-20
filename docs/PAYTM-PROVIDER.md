# Paytm provider

Status: built and tested against constructed fixtures only. No Paytm account, no
key, no call to any Paytm endpoint has ever been made. Not enabled: with no
`PAYTM_*` variables set the provider is "not configured" and `getProvider("paytm")`
throws. It is also not in `availableMethods()`, so checkout does not offer it.
It needs the payments reviewer's sign-off before anything below "Proposals" is wired.

Code: `src/lib/payments/paytm.ts`, registry line in `src/lib/payments/index.ts`,
tests `paytm.test.ts`, constructed fixtures `__fixtures__/paytm.ts`.

## Where the documentation lives

`developer.paytm.com` and `business.paytm.com` both 301-redirect to
`www.paytmpayments.com/docs/`, which is where the pages below were read
(public pages only, nothing called).

## Flows and endpoints used

| Flow | Method and URL | Source |
|---|---|---|
| Initiate transaction | POST `https://securegw-stage.paytm.in/theia/api/v1/initiateTransaction?mid=..&orderId=..` (production `securegw.paytm.in`) | Initiate Transaction API page |
| Transaction status | POST `https://securegw-stage.paytm.in/v3/order/status` (production `securegw.paytm.in`) | **ASSUMPTION**: the status page did not print its URL (it points at the dashboard). This is Paytm's long-standing v3 endpoint. Confirm from the dashboard. |
| Refund | POST `https://securestage.paytmpayments.com/refund/apply` (production `secureglobal.paytmpayments.com`) | Refund API page |
| Refund status | POST `https://securestage.paytmpayments.com/v2/refund/status` (production `paytmpayments.com/v2/refund/status`) | Refund Status API page |
| Callback / webhook | Paytm posts key-value pairs to the callback URL and the webhook URL | Payment Status page |

### Initiate transaction

Body: `requestType: "Payment"`, `mid`, `websiteName`, `orderId` (unique, at most 50
alphanumeric characters), `callbackUrl`, `txnAmount: { value: "940.00", currency: "INR" }`,
`userInfo: { custId }`. Head: `signature`. Response: a `txnToken` used by Paytm's
checkout on the client. We use our own order id as Paytm's `orderId`, so a retry
reaches the same Paytm order. The request has no timestamp or random field, so it is
byte-identical each time (the checksum salt is random, the signed body is not).
`userInfo.custId` is the order id: no customer personal data is sent to Paytm.
ASSUMPTION: a success answer is `resultInfo.resultStatus == "S"` with a non-empty
`txnToken` (the page listed a token but not the result codes).

### Transaction status

Body `{ mid, orderId }`, head `signature`. Response `body.resultInfo.resultStatus` is
`TXN_SUCCESS`, `TXN_FAILURE`, `PENDING` or `NO_RECORD_FOUND`, with `txnId`, `orderId`,
`txnAmount` ("940.00"), `paymentMode` (UPI, CC, DC, NB, PPI).

### Refund and refund status

Refund body: `mid`, `txnType: "REFUND"`, `orderId`, `txnId`, `refId` (our refund row id),
`refundAmount` ("940.00", two decimals), `comments` (at most 500). `refId` is Paytm's
idempotency: a duplicate within 10 minutes answers code 617. Answers: `TXN_SUCCESS`,
`PENDING`, `TXN_FAILURE`; codes 601, 628, 677 pending; 617 duplicate; 629 already
successful; 620 insufficient balance. Refund status body: `mid`, `orderId`, `refId`;
answers add `NO_RECORD_FOUND` (code 631).

### Callback and webhook fields

`ORDERID`, `TXNID`, `STATUS` (TXN_SUCCESS or TXN_FAILURE), `RESPCODE`, `RESPMSG`,
`TXNAMOUNT`, `PAYMENTMODE`, `CHECKSUMHASH`. Paytm says to always verify
`CHECKSUMHASH` and to confirm with the Transaction Status API, since a webhook may be
delayed or missed.

## Checksum

The docs pages say "SHA256 hashing and AES128 encryption", that a JSON request is
signed over the complete body string with the merchant key, and that the signature goes
in `head.signature`. **They do not print the salt, IV, mode or a test vector.** What is
implemented is Paytm's published checksum library as I know it, and it is the single
biggest assumption here:

1. salt: 4 characters (3 random bytes, base64)
2. `hash = sha256("<message>|<salt>")` in hex, then append the salt (68 characters)
3. encrypt with AES-128-CBC, PKCS7, key = the 16-byte merchant key, fixed IV
   `@@@@&&&&####$$$$`, output base64
4. verify: decrypt, take the last 4 characters as salt, recompute, compare in constant time
5. API bodies: message is `JSON.stringify(body)`. Callbacks: keys sorted, values joined
   with `|`, null or "null" as empty, `CHECKSUMHASH` excluded

The test pins one vector computed independently with openssl from this description. That
proves the code does what is written above, not that Paytm agrees. **Before go-live:** run
the Paytm sandbox (or their SDK's `generateSignature`) on one message and compare.
Also unverified: a response's `head.signature` is checked over `JSON.stringify(parsed body)`,
which matches Paytm's samples but depends on key order surviving the parse.

## What stays safe if an assumption is wrong

- Capture never believes a callback or a response it cannot verify. A wrong checksum
  scheme makes every response fail verification, so nothing is ever captured (fails
  closed, visible as retryable "unavailable") rather than wrongly captured.
- Capture is ok only for a verified `TXN_SUCCESS` with our order id, exactly our amount,
  and a matching transaction id. `PENDING`, `NO_RECORD_FOUND`, an unknown status, a non-200,
  a bad signature and a network error are all "not yet", never a final decline and never paid.
- Refunds: only a verified `TXN_SUCCESS` for exactly the amount asked is money back. A
  duplicate or already-successful code, a different amount, a 5xx, a 409, a 429, a
  timeout or a bad signature is ambiguous (the row stays reserved and `findRefund` looks
  it up by `refId`). Only a verified `TXN_FAILURE` or a definite 4xx is a refusal.
  ASSUMPTION: every other `TXN_FAILURE` code means no money moved.
- `NO_RECORD_FOUND` from refund status is "not found", which lets a resumed refund ask
  again. If Paytm's status lags its apply, that could double-ask; `refId` duplicate
  detection (617, 10 minutes) is the backstop, and only for 10 minutes. The reviewer
  should decide whether a wait is needed before a refund is asked again.

## Identifiers and how the interface is used

- `providerOrderId` = our order id (the intent is created before the order row, per
  HANDOVER 25, so the id is reserved first; it must match `^[A-Za-z0-9@_.-]{1,50}$`, and a
  UUID does).
- `providerPaymentId` is stored as `<orderId>:<txnId>` because a Paytm refund needs both
  and `refund()` receives only the payment id. `capture()` accepts a bare txn id when
  `providerOrderId` is also given, and returns the composite.
- `createIntent` returns the interface's `PaymentIntent`, which has no place for the
  `txnToken` the browser needs. `initiatePaytmTransaction()` is exported and returns it.
  See Proposals.
- `capture`'s `signature` argument is ignored: a callback's hash covers all its fields, so
  one string cannot be verified alone. Use `verifyWebhook` for the callback and `capture`
  for the truth.
- Amounts: `toPaytmAmount` and `fromPaytmAmount` are wire formatting only (paise bigint
  to "940.00" and back, strict). They are not display formatting, which stays `formatINR`.

## What the owner must obtain from Paytm

1. A Paytm Payment Gateway merchant account (business KYC), activated for online payments.
2. Test (staging) credentials first, then production credentials. Both are different
   sets. Staging first, and a test payment in staging before production is enabled.
3. **Merchant ID (MID)**, 20 characters, per environment. Goes in `PAYTM_MID`.
4. **Merchant key**, exactly 16 characters, per environment, secret. Goes in `PAYTM_MERCHANT_KEY`.
   A key of any other length is treated as "not configured".
5. **Website name** (`PAYTM_WEBSITE_NAME`): `WEBSTAGING` for staging, `DEFAULT` (or the
   registered name Paytm gives) for production. Industry type (for food and restaurant)
   is set on the merchant profile by Paytm.
6. The **callback URL** to register, and to put in `PAYTM_CALLBACK_URL`, on frybirdiq.tech
   (proposed `/api/paytm/callback`, see Proposals), plus the **webhook URL** registered in the
   Paytm dashboard (the same route is fine). It must be a public https URL.
7. **Settlement details**: the bank account Paytm settles to, the settlement cycle, and
   the MDR/fee rates (so the fee can be recorded on the payment).
8. Refund settings: whether refunds are enabled on the account, instant refund
   (`preferredDestination: TO_INSTANT`) availability, and the refund window.
9. Which payment modes (UPI, cards, net banking, wallet) are enabled on the MID.
10. Confirmation of the Transaction Status API URL for the account (the docs pages
    say to read it from the dashboard) and of the initiate result code for success.
11. Set `PAYTM_ENV` to `staging` or `production` (there is no default), on the server only.

## Assumptions made (all of them)

1. The checksum algorithm and its parameters (above). Highest risk, checked by one
   independently computed vector, not by Paytm.
2. The Transaction Status endpoint URL (v3/order/status on the securegw hosts).
3. Initiate success is `resultStatus "S"`.
4. Refund and refund-status answers use `body.resultInfo` and `body.refundId`,
   `body.refundAmount` as strings, in a signed `{ head, body }` envelope.
5. All refund answers are signed the way status answers are.
6. `TXN_FAILURE` on refund, other than 617 and 629, means no money moved.
7. `TXN_SUCCESS` on a status check carries `txnAmount` in rupees with two decimals.
8. Paytm order ids may contain letters, digits and `@ _ . -`, at most 50.
9. Paytm's callback field values are strings; the route will turn the form post into a
   JSON object of them.
10. A callback's `CHECKSUMHASH` covers every other posted field (as the library does).

## Proposals (not built: outside this card, payments-reviewer territory)

None of these edit `payments.ts`, `orders.ts`, `actions.ts`, the Razorpay webhook route or checkout.

1. **Callback and webhook route** `POST /api/paytm/callback`. Read the raw form body, convert
   to an object, run `paytmProvider.verifyWebhook`, then handle it exactly as the Razorpay
   webhook handler does: dedupe on the returned `eventId`, and never trust the callback beyond
   "go and look": call `paytmProvider.capture({ orderId, amount: <server's amount for the
   order>, providerOrderId: ORDERID, providerPaymentId: TXNID })` and let the service layer set
   status. Respond 200 only after the outcome is recorded; a retryable `GATEWAY_UNAVAILABLE`
   answers 5xx so Paytm retries. The customer's browser return (same callback URL, POST) should
   only redirect to the order page, which reads state from our database.
2. **`txnToken` for the client.** Either add an optional `clientToken?: string` to
   `PaymentIntent` (interface change, reviewer's call) or have the checkout action call
   `initiatePaytmTransaction` directly for this provider.
3. **Checkout offering.** Add a Paytm entry to `availableMethods()` only behind
   `isPaytmConfigured()` and its own toggle, after 1 and 2 exist.
4. **Amount at capture.** The caller must pass the server-computed amount, never one
   from the callback, exactly as with Razorpay.
5. **Refund wait.** Decide whether a refund whose `findRefund` says "not found" must wait
   past Paytm's status lag (and the 10 minute duplicate window) before asking again.
6. **Reconciliation.** A periodic status check on orders that stayed pending, as a backstop
   for a missed webhook. Paytm itself recommends confirming with the status API.
