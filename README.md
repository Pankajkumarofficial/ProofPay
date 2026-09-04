# ProofPay

**Money moves when the promise is proven.**

**Live: <https://proofpay-otbd.onrender.com>** — the free tier sleeps after 15
minutes, so the first request can take ~50 seconds to wake it.

A payment knows *who* is paid and *how much*. ProofPay also knows *why* the money
should move, *what* has to be true first, *what evidence* would show it, and
*whether that has actually happened*.

You write a promise the way you'd say it out loud:

> "I'll pay Rahul ₹10,000 when he delivers the website, all five acceptance
> tests pass, and I approve the final version."

The Proof Engine turns that sentence into an amount, a recipient, and a set of
conditions that can each be independently checked. Money is held conditionally.
Evidence is filed against individual conditions and assessed. Nothing is
released until every condition is proven **and** the payer explicitly confirms.

---

## The constraint that shaped the product

The obvious way to build this is custodial escrow: take the payer's money in,
hold it, pay it out when the conditions are met. **In India that requires a
payment aggregator licence.** ProofPay does not have one, and a student project
claiming to hold other people's money is not a demo, it is a compliance problem.

So ProofPay does not hold money at all. It proves the promise, gates the release
behind a human decision, and then hands that person an **NPCI deep link** their
own bank app executes:

```
upi://pay?pa=asha@okhdfcbank&pn=Asha%20Rao&am=1500.00&cu=INR
         &tn=ProofPay%20PRM-QKDM-NDBR&tr=PRM-QKDM-NDBR
```

The money moves bank-to-bank between the two people. ProofPay is never in the
path of the funds, which is exactly why it needs no licence to be real.

Three consequences run through the whole codebase:

- **The engine never moves money.** It reads, assesses and recommends.
  Fulfillment requires an authenticated payer and an explicit typed
  confirmation — there is no path from a model to a release.
- **Released is not the same as arrived.** `PAYMENT_STATUS` stops at `RELEASED`,
  the payer's decision. A separate `PAYOUT_STATUS` carries what the bank rail
  actually did. The UI shows both and never claims money landed because a button
  was pressed.
- **What cannot be verified is labelled, not assumed.** ProofPay cannot ask a
  bank whether a transfer settled, so no payout is ever recorded as
  `provider-confirmed` — a UPI reference is graded on what its structure can
  support, and recorded as *reported by the payer*.

The rest of this README is largely the working-out of those three lines.

---

## Quick start

```bash
npm run install:all     # installs backend and frontend
npm run dev             # API on :5050, web on :5173
```

Open <http://localhost:5173>.

**No MongoDB installed?** Nothing to do — the API detects an unreachable
database and boots an ephemeral one automatically (`ALLOW_MEMORY_DB=true`, the
default). Data resets on restart, which is fine for a walkthrough.

**Want data that survives restarts?** Run a real local mongod in a second
terminal, then seed it:

```bash
npm run mongo           # a real mongod on :27017, data in backend/.mongo-data
npm run seed            # builds the demo world through the ordinary models
```

Seeded accounts — `demo@proofpay.app`, plus `rahul@`, `sarah@`, `meera@` — all
use the password `proofpay123`.

---

## Judge Mode

Sign in and open **Judge Mode** in the sidebar. It walks the entire lifecycle —
Intent → Conditions → Proof → Validation → Fulfillment — against live database
state. "Build the scenario" creates a real promise, real conditions, a real
funding record and real proof **through the ordinary API**. Nothing on that page
is staged: a tick appears only once the record has earned it.

---

## The Proof Engine

The engine is **provider-agnostic**. One key, any of three vendors or an
OpenAI-compatible gateway, and a deterministic engine underneath them all:

| | When | Default model |
|---|---|---|
| **OpenAI** | key starts `sk-` | `gpt-4.1-mini` |
| **Anthropic** | key starts `sk-ant-` | `claude-sonnet-5` |
| **Gemini** | key starts `AIza` or `AQ.` | `gemini-3.6-flash` |
| **Gateway** | `AI_BASE_URL` is set | none — `AI_MODEL` names it |
| **Local engine** | no key set, or the model call fails | — |

The provider is read from the key's own prefix, so pasting a key is enough —
there is no second setting to keep in sync with it. `AI_PROVIDER` and `AI_MODEL`
override that when you want them to.

`sk-` is the one prefix that is genuinely ambiguous: DeepSeek, Groq, Together,
Mistral and OpenRouter all issue keys that start the same way as OpenAI's, and a
key sent to the wrong vendor comes back as a plain `401`. So a rejection on an
inferred provider says it was inferred, and names `AI_PROVIDER` as the way to
correct it — otherwise "your key is bad" is indistinguishable from "your key is
fine and went to the wrong company".

### Gateways, and why the label matters

Frontier-model access is more often resold than granted, and a reseller speaks
OpenAI's wire format while serving somebody else's models. Point `AI_BASE_URL`
at one and name the model:

```
AI_BASE_URL=https://tabitoken.com/v1
AI_MODEL=claude-opus-5
```

The request then goes there rather than to OpenAI. Three things follow, and the
third is the one that matters:

- **The URL selects the provider, not the key.** Every gateway issues `sk-…`, so
  prefix detection would send all of them to OpenAI. `AI_BASE_URL` wins outright.
- **There is no default model.** A vendor has a house model worth guessing; a
  gateway's catalogue is whatever it chose to resell, so an unnamed model is a
  startup error rather than an empty string and a confusing `400`.
- **A gateway is labelled by its host.** `tabitoken.com`, never `openai`. The app
  claims that a reading is never attributed to a model that did not make it, and
  calling a reseller of Claude "openai" because it borrowed OpenAI's protocol
  would break that claim in the one place anyone would check it — the badge on
  the assessment, and the engine column in the evaluation report.

Everything vendor-specific lives in one file (`aiProviders.js`); the retry loop,
schema validation and fallback are shared. A key that runs out of credit is a
config change, not a rewrite — which is the point, because they do run out.

The app runs completely with no API key. The local engine is a real fallback,
not a stub, and **the UI labels which engine produced every assessment** —
a reading is never attributed to a model that did not make it. `GET /api/health`
and `GET /api/ai/status` both report the live provider and model.

Two rules hold regardless of which engine is running:

- **It refuses to guess.** "Pay when the work is good" is not a condition. The
  ambiguity detector flags the vague phrase and asks what artefact would
  actually settle it, before a rupee is committed.
- **It never moves money.** The engine reads, assesses and recommends.
  Fulfillment requires an authenticated payer and an explicit typed
  confirmation (`confirm: true`) — there is no path from a model to a release.

---

## Architecture

```
backend/                 Express + MongoDB (Mongoose), ES modules
  src/routes/            HTTP surface, one router per resource
  src/controllers/       Request handling
  src/services/          proofEngine · localEngine · aiClient · payment ·
                         payout · payoutSimulator · scoring · notifications ·
                         audit · eventBus
  src/prompts/           Model prompts, one per capability
  src/services/aiProviders.js  the only vendor-specific code
  src/models/            User · Promise · Condition · Evidence · Verification ·
                         Payment · Dispute · Notification · AuditLog · AIAnalysis
  src/validators/        Zod schemas — every request body, query and param
  seed.js                Demo world, written through the real models

frontend/                React 18 + Vite + Tailwind + Framer Motion
  src/pages/             16 screens
  src/components/        PromiseMap · PromiseConstellation · EvidenceVault ·
                         ProofEngine · charts · UI primitives
  src/services/          One axios client, one module per resource
```

**Authorisation is not a per-route decision.** Every read goes through
`PromiseModel.visibilityFilter(user)`, and `loadPromiseForUser()` is the single
door to a promise — a client-supplied user id is never trusted.

**The session is an httpOnly cookie.** There is no token in JavaScript to leak.

**The Chronicle is append-only.** Every promise, condition, submission,
assessment and release writes an audit line with a timestamp and an author.

---

## Configuration

Copy `backend/.env.example` to `backend/.env`. Everything has a working default;
nothing below is required to run the app locally.

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `5050` | Not 5000 — macOS AirPlay Receiver answers there with a 403 |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/proofpay` | Local or Atlas |
| `ALLOW_MEMORY_DB` | `true` | Boots an ephemeral mongod when the URI is unreachable |
| `JWT_SECRET` | dev fallback | Must be 32+ chars in production, or boot fails |
| `AI_API_KEY` | *(empty)* | Empty → local deterministic engine |
| `AI_PROVIDER` | `auto` | `openai` \| `anthropic` \| `gemini` \| `gateway`; `auto` reads the key prefix |
| `AI_MODEL` | *(empty)* | Blank uses each provider's default; **required** with `AI_BASE_URL` |
| `AI_BASE_URL` | *(empty)* | An OpenAI-compatible gateway; overrides prefix detection |
| `AI_MAX_TOKENS` | `16000` | Ceiling on one answer; lower it for an account billed against the ceiling |
| `AI_OVERLOAD_RETRY_MS` | `5000` | Opening wait when the provider is busy (503/529); doubles on each refusal |
| `PAYMENT_MODE` | `demo` | `demo` \| `razorpay` — see **Payments** below |
| `GOOGLE_CLIENT_ID` / `_SECRET` | *(empty)* | Both set → Google sign-in appears |
| `MAX_UPLOAD_MB` | `10` | |

Production boot refuses to start on a short `JWT_SECRET` or a missing
`MONGODB_URI` rather than silently breaking auth.

---

## Payments

Two adapters share one interface, chosen by `PAYMENT_MODE`. No screen knows which
is active — `paymentApi.fundWithCheckout()` handles both.

**`demo`** (default) settles locally in a single request. The full
held → released lifecycle works, with no provider and no credentials.

**`razorpay`** funds in two legs, because a payer has to authorise the charge in
the provider's own checkout:

1. `POST /promises/:id/fund` creates a Razorpay order and returns it with
   `requiresPayment: true`. **Nothing is held, and the promise is untouched.**
2. The browser opens Razorpay Checkout (loaded on demand — a demo-mode build
   never contacts the provider).
3. `POST /promises/:id/fund/verify` receives what Razorpay signed. The signature
   is recomputed server-side with the key secret, and only then is money held.

Set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`, and switch the mode:

```
PAYMENT_MODE=razorpay
```

If the mode is `razorpay` but credentials are missing, the service logs a warning
and falls back to demo settlement rather than failing.

Three things the verification step guarantees:

- **A partial payload is rejected** before it reaches the payment service.
- **A forged or wrong-secret signature is rejected**, and the promise stays
  unfunded.
- **A genuine receipt for a different order is rejected.** The signature only
  proves the provider signed *some* order; binding it to the order this promise
  opened is what stops one promise's receipt funding another.

### Checking the funding leg against the real provider

The integration tests prove those rules with a secret they invent, which shows
the logic is right without showing the credentials are. This does the opposite:

```bash
npm run check:razorpay --prefix backend
```

It opens a **real order at api.razorpay.com** with the configured test key,
reads it back, and runs the app's own verification against a signature computed
the way Razorpay computes it — for the order that was actually opened.

```
key rzp_test_TUl88… · mode razorpay · provider razorpay

  ✓ an order was opened at Razorpay: order_TXVGD8DDCCRnFE
  ✓ checkout carries the publishable key id, and no secret
  ✓ nothing is held yet — the promise is untouched until the payer authorises
  ✓ the provider returns the same order on a fresh read
  ✓ ₹1,500.00 reached the provider as 150000 paise, in INR
  ✓ a correctly signed receipt for this order holds the money
  ✓ a forged signature is refused
  ✓ a genuine receipt for another order is refused
```

Nothing is charged — test-mode orders move no money, and the script refuses to
run against a key that does not start `rzp_test_`. The one leg it cannot reach
is the browser one: authorising the charge happens inside Razorpay Checkout,
with a person and a test card. It stops where a person would start, rather than
implying a round trip it did not make.

### Payouts — the last mile

Capturing a payment only moves money as far as the platform's own account. A
**payout** carries it to the recipient. That is a third leg, and it behaves
differently from the other two:

```
PAYOUTS_ENABLED=true
PAYOUT_PROVIDER=simulated        # simulated | razorpayx
PAYOUT_SIM_SETTLE_MS=8000        # how long the simulated rail takes
RAZORPAYX_ACCOUNT_NUMBER=...     # razorpayx only — the account money is sent FROM
PAYOUT_MODE=IMPS                 # IMPS | NEFT | RTGS; UPI destinations use UPI
```

Three rails sit behind one interface, the same way the Proof Engine has three.

**`upi-intent`** is the one that moves real money without a licence, and it is
worth explaining why it exists.

Custodial escrow — taking the payer's funds in and paying them out later —
requires a payment aggregator licence in India. ProofPay does not have one and
does not pretend to. So it does not hold money at all: it proves the promise,
gates the release behind a person, then hands that person an **NPCI deep link**
their own bank app executes.

```
upi://pay?pa=asha@okhdfcbank&pn=Asha%20Rao&am=1500.00&cu=INR
         &tn=ProofPay%20PRM-QKDM-NDBR&tr=PRM-QKDM-NDBR
```

The payout sits at `pending` — the honest state, because the payer has
authorised the release and nothing has moved. It settles only when a reference
is supplied that survives validation.

**UTR validation grades, it does not gatekeep.** A UPI reference is twelve
digits shaped `Y DDD SSSSSSSS` — year digit, Julian day, then the bank's trace
number. But NPCI fixes only the length and leaves the composition to the issuing
bank, so real references turn up that decode to nothing. Refusing one would
strand a promise whose money has genuinely moved, with no way forward but a
database edit. So structure decides what a reference is *worth*, and only what
cannot be a reference at all is refused:

| Input | Result |
|---|---|
| `ABCD12345678` | rejected — letters |
| `12345` | rejected — 5 digits, not 12 |
| `111111111111`, `123456789012` | rejected — placeholders, not references |
| `624340271993` on the day of the release | **`format-checked`** — decodes to a date that fits the transfer |
| `660956253847` | **`payer-reported`** — day 609 is not a day of the year, so it could not be placed |
| a reference dated before the release, or in the future | **`payer-reported`**, with the date it reads |

Both grades are recorded, and the record says which: *"reported by you"* against
one, *"reported by you, not date-checked"* against the other, with the reason it
could not be placed carried alongside. A random twelve-digit guess earns the
stronger grade fewer than 1 time in 100, asserted by a test that tries two
thousand of them.

**What it cannot do, and never claims:** confirm with a bank that money actually
moved. That needs bank or aggregator access, so nothing here is ever recorded as
`provider-confirmed`.

---

**`simulated`** (default) runs the real state machine — `queued` → `processing` →
`processed`, with failures, reversals and generated UTRs — without moving money
or needing a bank. It exists because RazorpayX is business banking: a registered
entity, KYC and an activated account is a long way to go to see what a payout
looks like. It is never passed off as real: every payout it produces carries
`provider: 'simulated'` and the interface labels it.

Destinations can force an outcome, the way a provider's test card numbers do:

| Destination | Result |
|---|---|
| `fail@…` · account ending `0000` | fails after processing |
| `reverse@…` · account ending `9999` | processes, then the bank returns it |
| `reject@…` · account ending `1111` | rejected up front |
| anything else | settles, with a UTR |

**`razorpayx`** is the real rail. It is a **separate product** from Razorpay
collections, needing its own signup, KYC, a funded account and IP allowlisting.
Until it is activated the API answers payout calls with a generic *"The requested
URL was not found on the server"*, which reads like a bug in this code —
ProofPay translates that into a sentence naming the real cause.

Switching between them is one environment variable; nothing else changes.

**Released is not the same as arrived.** A payout is asynchronous: it can sit
`queued` for minutes and fail after a release was authorised. So `PAYMENT_STATUS`
stops at `RELEASED` — the payer's decision — and a separate `PAYOUT_STATUS`
carries what the bank rail actually did (`queued` → `processing` → `processed`,
or `failed` / `reversed` / `rejected`). The UI shows both, and never claims money
landed because a button was pressed.

Three properties worth knowing:

- **No account numbers are stored.** Details are posted straight to the provider,
  which returns opaque ids; ProofPay keeps the ids and a masked label
  (`HDFC ····0123`). A dump of the database exposes nobody's bank details.
- **A failed payout is recoverable.** `POST /promises/:id/payout/refresh` polls a
  payout in flight, and re-sends one that never reached the provider at all —
  otherwise a release during an outage would strand the money.
- **Retrying cannot pay twice.** The idempotency key is derived from the payment
  id, so a repeated request settles once at the provider.

A release with `PAYOUTS_ENABLED=false` is recorded as `NOT_SENT`: the promise
settled inside ProofPay, with no last mile at all.

---

## Tests

```bash
npm test --prefix backend
```

160 integration tests across 15 files, against a real ephemeral MongoDB and the
real Express app —
nothing stubbed, because the things worth testing here only misbehave against a
real database. No test framework is installed; it runs on `node --test`.

They cover the parts where being wrong costs money:

- **`releases exactly once under concurrent requests`** — ten simultaneous
  fulfil requests. This is a regression test for a real bug: the release used to
  read the payment status and then write it, so three of ten requests released
  the same money and the Chronicle recorded three releases. The claim is now a
  single atomic `findOneAndUpdate` matching on the status it replaces, and the
  database picks the winner.
- Release is refused while a condition is unproven, without an explicit
  `confirm: true`, and on a promise you cannot see.
- A funding signature is rejected when partial, when signed with the wrong
  secret, and when it belongs to a different order.
- A payout reports `queued` rather than claiming it arrived, settles with a UTR,
  survives a failure without undoing the release, keeps its UTR on a reversal,
  and is never re-sent once terminal.
- A payout destination reaches the Chronicle **masked**, and the account number
  and IFSC are never persisted at all.
- A model that is *busy* is told apart from one that is *metered*: a spike in
  demand is waited out with a growing pause, and is never reported as a rate
  limit. Both mean "no answer yet", and the code used to have a category for
  only one of them — see incident 4.
- A reading is recordable against a vendor, the local engine, or a **gateway
  host**, and against nothing else. A fixed enum of the three vendors silently
  refused every gateway reading; a pattern loose enough to admit one accepted
  `gpt-4.1-mini` as a host. A model name in the engine column is the exact
  misattribution the field exists to prevent, so both directions are asserted.
- **Uploaded proof still exists afterwards.** Files are written to MongoDB, not
  to a filesystem the host wipes on every redeploy, and are asserted to come
  back byte for byte. One test holds the line from incident 1 from a different
  side: the artefact's *contents* are extracted on upload, so a proof that
  cannot be opened can never be scored as one that was read.

That last pair caught a live bug the day they were written: the destination
audit used an action name that did not exist in the enum, so the write failed
silently and setting a destination never reached the append-only log.

---

## Evaluation

```bash
npm run eval --prefix backend                     # both engines, all three sets
npm run eval --prefix backend -- --only evidence  # just the set the report ranks on
npm run eval --prefix backend -- --local          # rules only, no key, no cost
```

**Check how your provider bills before re-running this.** Some gateways charge a
flat rate per call rather than per token, which makes a repeat run cost exactly
what the first one did — and makes re-running it to fix a label an expensive way
to fix a label. `--only evidence` buys 12 calls instead of 35, and buys the ones
that matter: false accepts are the error that moves money wrongly, and only the
evidence set can produce them. Sets the model was not asked about are printed as
*not scored*, which is deliberately distinct from asking and getting it wrong.

Scores both Proof Engines against the **same hand-labelled set** — 12 ambiguity
cases, 11 parse cases, 12 evidence cases — and writes `backend/eval/report.md`.
The labels were written before either engine ran, and several cases are ones the
deterministic engine is expected to win.

**The headline number is not accuracy — it is false accepts.** ProofPay releases
money only when a promise is proven, so waving through a claim with no artefact
behind it is the expensive error. An engine that scores well overall while making
those is worse than one that does not, and the report ranks on that.

The harness paces itself under free-tier rate limits, waits out a provider that
is merely busy, and a case the model still cannot answer is **recorded and
counted as a refusal** rather than crashing the run — no answer must never read
as approval.

That distinction is load-bearing, and it took two attempts to get right. A rate
limit and an overload both mean *no answer yet*; only one of them names a window
to come back in. Treating the second as a malformed response retried an
overloaded model three times in two seconds and scored the result as ignorance —
which is what incident 4 is about, and why a run under real contention now takes
minutes rather than reporting a number it did not earn.

---

## Type checking

```bash
npm run typecheck --prefix backend
```

The source is JavaScript, checked by TypeScript without being migrated to it.
Files opt in with a `// @ts-check` line, so the gate stays green and therefore
stays useful, instead of landing 86 errors at once and being ignored.

Currently checked: `utr.js`, `math.js`, `payoutSimulator.js`, `aiProviders.js` —
the pure-logic modules. Controllers come last, because Express and Mongoose
typings are where the real cost sits.

---

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | API + web together, prefixed output |
| `npm run dev:backend` / `dev:frontend` | Either half alone |
| `npm run seed` | Rebuild the demo world (`node seed.js --keep` to append) |
| `npm run mongo` | A real local mongod with a persistent data directory |
| `npm test --prefix backend` | Integration tests on an ephemeral MongoDB |
| `npm run eval --prefix backend` | Score both Proof Engines on the labelled set |
| `npm run check:razorpay --prefix backend` | Open a real test-mode order and verify the funding leg |
| `npm run check:ai --prefix backend` | Resolve the engine config and make one live call (`-- --models` lists the catalogue) |
| `npm run typecheck --prefix backend` | Type-check the JavaScript |
| `npm run build` | Production frontend bundle |
| `npm start` | API only |

---

## API

All routes are under `/api`. Auth is a cookie; every body, query and param is
validated with Zod, and errors come back as a message written for a person.

```
GET    /health                        active engine, payment mode, status

POST   /auth/register · /login · /logout
GET    /auth/me · /profile · /config
GET    /auth/google · /google/callback

GET    /promises · POST /promises · GET /promises/search
GET    /promises/:id · PATCH · DELETE
POST   /promises/:id/fund             demo: holds immediately
                                      razorpay: opens an order, holds nothing
POST   /promises/:id/fund/verify      checks the provider signature, then holds
POST   /promises/:id/fulfill          requires confirm:true — the only release
POST   /promises/:id/payout-destination   registers where the recipient is paid
POST   /promises/:id/payout/refresh   polls a payout, or re-sends a failed one
POST   /promises/:id/recalculate
GET    /promises/:id/conditions · /chronicle · /briefing
POST   /promises/:id/conditions

PATCH  /conditions/:id · DELETE · POST /conditions/:id/confirm

GET    /evidence · POST /evidence     multipart or JSON, both land here
GET    /evidence/:id · DELETE
POST   /evidence/:id/verify

GET    /disputes · POST /disputes · GET /disputes/:id
POST   /disputes/:id/evidence · /analyze · /resolve

GET    /ai/status
POST   /ai/parse-promise · /detect-ambiguity · /analyze-evidence · /analyze-dispute

GET    /dashboard · /promise-space · /analytics · /chronicle
GET    /notifications · PATCH /notifications/:id/read · /read-all
GET    /stream                        server-sent events
POST   /demo/scenario                 builds the Judge Mode scenario
```

---

## Promise lifecycle

```
DRAFT → FUNDED → PARTIALLY_VERIFIED → READY_TO_FULFILL → SETTLING → FULFILLED
                          ↓
                      CONTESTED → resolved (released · refunded · partial · dismissed)
```

SETTLING is the gap between a decision and a transfer. The payer authorising the
release is not the same fact as the recipient being paid, and on the UPI rail
ProofPay sends nothing at all — it hands the payer a pre-filled payment their own
bank app executes. A promise stays SETTLING until the payout reports `processed`
or the payer records the UTR; only then does it read as FULFILLED.

A contest freezes the promise: no money moves in either direction until it is
resolved, and both sides can file statements and proof. The engine lays out
which conditions are proven, which have no proof on record, and where the
accounts contradict each other. It recommends. **A person decides.**
