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

The engine has two interchangeable implementations behind one interface:

| | When | What it does |
|---|---|---|
| **Claude** | `AI_API_KEY` is set | Parses promises, detects ambiguity, assesses evidence, reads contests |
| **Local engine** | no key set | The same five capabilities, deterministic and rule-based |

The app runs completely with no API key — the local engine is a real fallback,
not a stub, and the UI labels which one produced every assessment. `GET
/api/health` and `GET /api/ai/status` both report the active engine.

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
  src/prompts/           Claude prompts, one per capability
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
| `AI_MODEL` | `claude-opus-5` | |
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

Two rails sit behind one interface, the same way the Proof Engine has two.

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

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | API + web together, prefixed output |
| `npm run dev:backend` / `dev:frontend` | Either half alone |
| `npm run seed` | Rebuild the demo world (`node seed.js --keep` to append) |
| `npm run mongo` | A real local mongod with a persistent data directory |
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
DRAFT → FUNDED → PARTIALLY_VERIFIED → READY_TO_FULFILL → FULFILLED
                          ↓
                      CONTESTED → resolved (released · refunded · partial · dismissed)
```

A contest freezes the promise: no money moves in either direction until it is
resolved, and both sides can file statements and proof. The engine lays out
which conditions are proven, which have no proof on record, and where the
accounts contradict each other. It recommends. **A person decides.**
