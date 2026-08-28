# ProofPay

**Money moves when the promise is proven.**

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

The engine is **provider-agnostic**. One key, any of three vendors, and a
deterministic engine underneath them all:

| | When | Default model |
|---|---|---|
| **OpenAI** | key starts `sk-` | `gpt-4.1-mini` |
| **Anthropic** | key starts `sk-ant-` | `claude-sonnet-5` |
| **Gemini** | key starts `AIza` or `AQ.` | `gemini-3.6-flash` |
| **Local engine** | no key set, or the model call fails | — |

The provider is read from the key's own prefix, so pasting a key is enough —
there is no second setting to keep in sync with it. `AI_PROVIDER` and `AI_MODEL`
override that when you want them to.

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
  src/pages/             14 screens
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
| `AI_PROVIDER` | `auto` | `openai` \| `anthropic` \| `gemini`; `auto` reads the key prefix |
| `AI_MODEL` | *(empty)* | Blank uses each provider's default |
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

**UTR validation is structural, not cosmetic.** A UPI reference is twelve digits
shaped `Y DDD SSSSSSSS` — year digit, Julian day, then the bank's trace number.
That structure is what makes an invented number detectable:

| Input | Result |
|---|---|
| `ABCD12345678` | rejected — letters |
| `12345` | rejected — 5 digits, not 12 |
| `699940271993` | rejected — day 999 does not exist |
| a reference dated before the release | rejected — belongs to an earlier transfer |
| a reference dated in the future | rejected |
| the same reference twice | rejected — already settled |

A random twelve-digit guess passes fewer than 1 time in 100, asserted by a test
that tries two thousand of them.

**What it cannot do, and never claims:** confirm with a bank that money actually
moved. That needs bank or aggregator access. So a settled payout is recorded as
`verification: 'format-checked'` and reads *"reported by you"* in the interface
— never as a bank confirmation.

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

19 integration tests against a real ephemeral MongoDB and the real Express app —
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

That last pair caught a live bug the day they were written: the destination
audit used an action name that did not exist in the enum, so the write failed
silently and setting a destination never reached the append-only log.

---

## Evaluation

```bash
npm run eval --prefix backend            # both engines
npm run eval --prefix backend -- --local # rules only, no key, no cost
```

Scores both Proof Engines against the **same hand-labelled set** — 12 ambiguity
cases, 6 parse cases, 12 evidence cases — and writes `backend/eval/report.md`.
The labels were written before either engine ran, and several cases are ones the
deterministic engine is expected to win.

**The headline number is not accuracy — it is false accepts.** ProofPay releases
money only when a promise is proven, so waving through a claim with no artefact
behind it is the expensive error. An engine that scores well overall while making
those is worse than one that does not, and the report ranks on that.

The harness paces itself under free-tier rate limits, and a case the model cannot
answer is **recorded and counted as a refusal** rather than crashing the run — no
answer must never read as approval.

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
