# What broke, and how we got out

Seven failures worth writing down. Each was diagnosed wrongly at least once,
which is the interesting part — the symptom pointed somewhere the cause was not.

---

## 1. The image that never reached the model

**Symptom.** A payer uploaded a signed attestation against a condition and the
promise sat at **10% Proof Confidence**. The proof was obviously valid to anyone
who opened it. Promise Health read 38%, "At risk".

**The wrong theory.** The scoring weights looked wrong. Conditions 0%, Evidence
100%, Verification 18% — the natural reading is that the thresholds are too
harsh, and the fix is to lower them.

**What it actually was.** Working backwards from the numbers: `conditionScore`
returns `confidence/100 × 0.6` for a `VERIFYING` condition, so 10% implied the
engine had returned roughly 18% confidence. It had. The reason was in the
prompt:

```
File: proofpay-sample-attestation.png (image/png)
```

That was the entire description of the artefact. The pipeline was text-only end
to end — `readTextEvidence` only handled four text MIME types, so an image
produced no `extractedText` and the model was handed a *filename*. The system
prompt then did exactly what it was told:

> cap confidence at 60 when the artefact's contents were not provided

60 is below the ≥70 threshold that verifies a condition. **No image could ever
prove anything.** The ceiling was structural, not a tuning problem.

**The fix.** Images and PDFs now travel as real multimodal content — Gemini
`inline_data`, Anthropic `image`/`document` blocks, OpenAI `image_url` data
URLs — attached to the first user turn only, so a validation retry stays text.
The 60% cap now applies only when nothing was attached.

**Measured, on the same real image:**

| | verdict | confidence |
|---|---|---|
| before | `INSUFFICIENT` | 60 |
| after | `SUPPORTS` | 92 |

**What we'd do differently.** The codebase already knew. A comment in the
deterministic engine read *"an image goes to neither engine as an image."* It
was accurate, it was months old, and nobody had connected it to the score people
were complaining about. A known limitation written down in one file is not the
same as a known limitation.

---

## 2. The API that was never down

**Symptom.** The interface showed *"We could not reach ProofPay. Check that the
API is running."* Repeatedly, across a whole afternoon, on different pages.

**The wrong theory.** The API had crashed. It had not:

```
health: 200 in 0.002464s
```

Two milliseconds, every time, while the browser insisted it was unreachable.
Through the Vite proxy too. So the server was fine and the message was a lie —
but not a lie anyone had written.

**What it actually was.** The error message only appears for `ERR_NETWORK` or
`ECONNABORTED`. The second is axios's own 45-second timeout. The requests were
not being *refused*; they were **hanging**.

`useLiveUpdates` constructed a new `EventSource` per call:

```js
source = new EventSource('/api/stream', { withCredentials: true });
```

Three components subscribe on `/space` — the shell, its notification bell, and
the page. Each holds a persistent HTTP connection, and a browser allows **six
per origin** over HTTP/1.1. Add the dev server's HMR socket and each `<img>`
served from `/uploads`, and ordinary `fetch` calls queued behind connections
that never close, until axios gave up and reported a network failure.

A dead server and an exhausted connection pool are indistinguishable from
inside the browser. That is why it was misdiagnosed three times.

**The fix.** One module-level connection, many subscribers; the last unmount
closes it. The sharing is not an optimisation, it is the correctness fix.

**What we'd do differently.** Trust the measurement over the message. The
message said the API was unreachable; `curl` said it answered in 2ms. Those
cannot both be true, and the disagreement was the whole clue — but it took
three rounds of restarting a healthy server before anyone read it that way.

---

## 3. The eval that scored a quota

**Symptom.** The Proof Engine evaluation reported:

```
evidence   accuracy 58% · FALSE ACCEPTS 0 · false refusals 5
⚠ 15 case(s) unanswered
```

58% looks like a mediocre model. It was tempting to report it as one.

**What it actually was.** Every one of the twelve evidence cases showed
`Conf 0%` — Gemini answered **none** of them. The free tier's per-minute cap
rejected the run, and the harness counts an unanswered case as a refusal,
because *"no answer must never read as approval."* Seven of the twelve cases are
labelled REFUSE, so defaulting scored exactly those seven. `7/12 = 58%`.

**The number measured the API quota, not the model.**

**The bug underneath.** The harness opted into waiting out rate limits but not
into the patient path added the same day, so it ran on a 30-second deadline and
abandoned each timeout after one attempt. The eval is the textbook caller with
nobody waiting on it, and it was configured as though someone were.

**The fix.** The harness now takes the patient path: a 90-second deadline, three
attempts, three rate-limit waits. That does not fix a free-tier quota — that is
a billing problem, not a code problem — and saying so is more useful than
publishing 58%.

**What this one is really about.** The harness behaved correctly under total
failure: it recorded every unanswered case rather than dropping it, it refused
to let silence read as approval, and both engines still finished with **zero
false accepts**. An evaluation that flatters itself when its model is down is
worth nothing. This one didn't.

---

## 4. The busy model that was recorded as a stupid one

**Symptom.** Incident 3 was supposed to have fixed the eval harness: the patient
path, three attempts, three rate-limit waits. It ran again and still could not
finish. A smoke run over six cases lost two of them:

```
WARN Proof Engine attempt 1 failed: This model is currently experiencing high demand.
WARN Proof Engine attempt 2 failed: This model is currently experiencing high demand.
WARN Proof Engine attempt 3 failed: This model is currently experiencing high demand.
  !
```

**The wrong theory.** The obvious read is the one incident 3 ended on — a free
tier that has run out, a billing problem rather than a code problem. That
conclusion was already written down, which made it easy to reach for twice.

**What it actually was.** The three attempts carry timestamps, and they land
inside **2.1 seconds**. That is not a quota. It is `backoffMs`:

```js
const TRANSIENT_RETRY_MS = 700;
const backoffMs = (attempt) => TRANSIENT_RETRY_MS * 2 ** (attempt - 1);
```

700ms, then 1400ms. The retry loop has a perfectly good waiting mechanism — the
one incident 3 added — but it only opens for an error carrying `retryAfterMs`,
and:

```js
function retryDelayMs(status, message) {
  if (status !== 429) return null;   // ← a 503 gets no wait at all
```

A 429 says *come back in 41 seconds*. A 503 says *I am busy* and names no
window, so it fell through to the generic path meant for a malformed response —
and asked an overloaded machine the same question three times in two seconds.
Every refusal was then recorded as a case the model could not answer.

**Two failures wearing each other's clothes.** A rate limit and an overload both
mean *no answer yet*, and the code had a category for only one of them. The log
line made it worse by calling everything it waited on a rate limit — sending
whoever read it to check a quota that was fine.

**The fix.** 503 and Anthropic's 529 are classified as overload and given a
wait. The wait escalates, because unlike a 429 the provider named no window:

```
WARN Proof Engine overloaded; waiting 5s.
WARN Proof Engine overloaded; waiting 10s.
WARN Proof Engine overloaded; waiting 20s.
```

35 seconds of patience per case where there had been two. The message says
"overloaded" and not "rate limited", and names what is *not* wrong — the key,
the prompt — because that is where the reader would otherwise go looking.

**What we'd do differently.** Incident 3 fixed *how long* the harness waits and
never asked *what it waits for*. The patient path was real, it was correct, and
a 503 could not reach it. A retry policy is two decisions, not one: how long to
wait, and which failures deserve waiting at all. Getting the first right and
leaving the second at `status !== 429` looks like a working retry loop right up
until the provider is busy rather than metered.

The regression tests assert the shape rather than the duration — that a spike in
demand is waited out, that the second wait exceeds the first, and that an
overload is never reported as a rate limit — so they hold the behaviour without
holding the suite up for 35 seconds a case.

---

## 5. The key that was sent to a company that never issued it

**Symptom.** A brand new API key, pasted into `.env`, rejected immediately:

```
The openai key was rejected (401). Check AI_API_KEY.
```

**The wrong theory.** The key is bad — revoked, truncated, or mistyped. OpenAI's
own response said as much when asked directly:

```
error code : invalid_api_key
message    : Incorrect API key provided: sk-j8fr5***…33dj
```

That is about as unambiguous as an error gets, and it was wrong about the thing
that mattered.

**What it actually was.** The key was never OpenAI's. It came from a gateway —
one of the resellers that speak OpenAI's wire format while serving somebody
else's models. `detectProvider` reads the key's prefix:

```js
if (apiKey.startsWith('sk-')) return 'openai';   // ← the catch-all
```

`sk-` is not OpenAI's alone. DeepSeek, Groq, Together, Mistral and OpenRouter
all issue keys shaped that way. So the key was sent to `api.openai.com`, which
correctly reported that it had never issued it. **The key was valid. The address
was wrong.** And nothing in the message could say so, because the code did not
know the provider had been a guess.

**A second red herring on the way.** Probing the gateway with `curl` returned a
Cloudflare block page, which reads like "this host does not serve an API":

```
403  <-  https://tabitoken.com/v1/models
```

That nearly closed the investigation a second time. The 403 was Cloudflare
filtering on User-Agent, not the endpoint refusing:

| client | result |
|---|---|
| `curl` | `403` — Cloudflare block page |
| browser User-Agent | `401` — **the endpoint exists and wants auth** |
| Node `fetch` | `401` — passes the edge, which is what the app actually uses |

The one client whose behaviour mattered was the one the app runs on, and it was
never the one being tested.

**The fix.** `AI_BASE_URL` selects an OpenAI-compatible gateway, overriding
prefix detection — because a URL is knowledge and a prefix is a guess. There is
no default model: a vendor has a house model worth guessing, a gateway's
catalogue is whatever it chose to resell, so an unnamed model is a startup error
rather than an empty string and a confusing `400`.

And a gateway is labelled by its **host**, never by the vendor whose protocol it
borrows.

**The fix's own bug, which was worse than the original.** Adding the provider
broke the field that records who answered:

```
AIAnalysis validation failed: engine: `gateway` is not a valid enum value
```

`engine` was a closed enum of the three vendors. Every reading produced through
a gateway **failed to save** — the assessment was lost, and the log blamed the
model. The constraint that made the field trustworthy was the same constraint
that rejected anything new.

Relaxing it introduced a subtler hole, caught by the test written for it: a
pattern loose enough to accept `tabitoken.com` also accepts `gpt-4.1-mini`,
which parses as `gpt-4` plus `1-mini`. A **model name sitting in the engine
column** is precisely the misattribution the field exists to prevent. The rule
is now a known engine, or a host whose final label is alphabetic.

**What we'd do differently.** Auto-detection was presented as fact everywhere it
appeared — the badge, the health endpoint, the logs, the error. It is an
inference from three characters, and it is wrong for an entire category of
provider. A guess is allowed to be wrong; what is not allowed is for it to be
unmarked, because the one place a system can admit it inferred something is the
moment that inference fails, and that is exactly where this said nothing.

The general form is worth keeping: **a convenience that removes a setting also
removes the place where being wrong about it would have shown up.** "Pasting a
key is enough" was a real improvement, and it quietly made one failure mode
undiagnosable.

---

## 6. The live site that signed you into your laptop

**Symptom.** On the deployed site — `proofpay-cknb.onrender.com`, the service at
the time — clicking **Continue with Google** ended at `localhost:5173/space` —
signed in, correct name, correct avatar, twenty-two promises. The deployment had
apparently handed the session to a different application.

**The wrong theory.** The build. A URL bar reading `localhost` after leaving a
`https://` origin looks exactly like a front end compiled with a development
address baked into it, so the search went to `frontend/dist`, then to
`VITE_API_PROXY`, then to whether `CLIENT_URL` had been set wrongly in the Render
dashboard. All three were fine. Nothing in the built bundle contains that host:
the client calls `/api` as a relative path, which is the whole reason both halves
share an origin.

**What it actually was.** `env.js` had already solved this problem once:

```js
clientUrl: process.env.CLIENT_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:5173',
```

and then, nine lines below, had not:

```js
callbackUrl: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:5050/api/auth/google/callback',
```

`render.yaml` declared no `GOOGLE_CALLBACK_URL` — deliberately, by the same
reasoning that omits `CLIENT_URL` — so the deployed service fell through to the
localhost default and sent it to Google as `redirect_uri`. Google did nothing
wrong: that address is a registered redirect URI for this OAuth client, because
local development uses it. So Google took the visitor's browser, as instructed,
to **port 5050 on the visitor's own machine**, where a copy of ProofPay happened
to be running. It completed the exchange, set its own cookie, and redirected to
its own `clientUrl`. Everything worked. It worked in the wrong process.

The tell was the port. `5173` is the Vite dev server — a number the deployed
service does not listen on, does not proxy, and never emits. Only a local `.env`
knows it. The destination was not evidence about the deployment at all; it was
evidence about the machine reading this sentence.

**For anybody else it was worse.** A judge without the repo checked out gets
`ERR_CONNECTION_REFUSED` on a dead tab, having left the product to get it.

**Why nothing caught it.** The button's condition for existing is

```js
get enabled() { return Boolean(this.clientId && this.clientSecret); }
```

Both were set in Render, so the button was offered. Nothing anywhere asked
whether the address it would send people to was reachable from the internet — a
question with an obvious answer that no code was in a position to ask.

**The fix.** Three parts, and only the first is the bug:

- `callbackUrl` derives from `RENDER_EXTERNAL_URL` the way `clientUrl` does.
- `assertProductionConfig()` refuses to boot when Google is enabled and the
  callback still points at `localhost` or `127.0.0.1`. Offering the button is
  strictly worse than not offering it: the visitor leaves and does not return.
- The server prints the redirect URI at boot, because it is the one string that
  must match the Google Cloud Console character for character, and comparing two
  strings should not require reading `googleService.js`.

**Then the fix did not work, for a reason worth more than the bug.**

The guard above never ran. `assertProductionConfig()` opens with
`if (!env.isProd) return`, and `isProd` is `nodeEnv === 'production'` — and the
live service's `NODE_ENV` was `development`. Nothing in the deployment said so;
it was found by reading a `Set-Cookie` header from the public host and noticing
the absence of `Secure`, which is `secure: env.isProd` reporting the same fact
from the other side.

`render.yaml` sets `NODE_ENV: production`. The service had been created from the
dashboard rather than from the blueprint, so it had never read that file — which
also explained a payout provider running live that the blueprint does not
declare. Everything keyed to `NODE_ENV` was silently off on a public site:
Content-Security-Policy, `Secure` on the session cookie, the strict auth rate
limit, suppressed 500-error hints, and the refusal to fall back to an in-memory
database. Each was written, tested, and inert.

So the switch changed from a declaration to a fact. `isDeployed` reads
`RENDER_EXTERNAL_URL` — set by the platform, and therefore not something a
dashboard can forget — and every hardening switch follows it. `isProd` still
exists and still means what a developer declared; nothing security-relevant asks
it any more.

And the localhost values are no longer merely *reported*. A service that knows
its own public address has no correct reading of "send the visitor to
localhost", so `CLIENT_URL` and `GOOGLE_CALLBACK_URL` are overruled when they
name a private address, with a warning at boot naming what was ignored. That
turned out to matter immediately: after the callback was corrected, `CLIENT_URL`
in the same dashboard was still `http://localhost:5173` — the identical bug, one
hop further along, waiting to reappear the moment Google started cooperating.

**The general form.** *A default that is right in development is not neutral in
production — it is a wrong answer with nothing attached to say so.* `localhost`
as a fallback reads as modest and safe, and it is neither: it names a real
machine, just never the right one.

Two sharper ones came out of the second half. **When one setting learns to
derive itself, the settings beside it do not** — the `RENDER_EXTERNAL_URL`
fallback was written, commented and documented, and it fixed exactly one of the
three places that needed it. And **a guard keyed to a variable is only as real
as the variable**: `NODE_ENV` describes an intention, is trivially absent, and
its absence is indistinguishable from a healthy service. The platform's own
statement of where it lives cannot be forgotten in the same way, which is the
only reason it is worth trusting over something a person types.

---

## 7. The vault that kept describing files it no longer had

**Symptom.** The Evidence Vault on the deployed site listed 54 artefacts. Every
row was complete: filename, `pdf · upload · 41KB · 11 hours ago`, the condition
it was filed against, and the Proof Engine's reading — *"a signed written client
approval from Pankaj, explicitly confirming that all assigned tasks were
completed to his satisfaction."* Nothing was shown for the files themselves.

**The wrong theory.** A missing preview. `EvidenceItem.jsx` renders an inline
`<img>` for `image` and `screenshot` and a text link for everything else, so a
vault of PDFs and a `.docx` legitimately displays no artefact. The obvious fix
was an embedded PDF viewer.

**What it actually was.** The files were gone.

```
GET /uploads/…_Signed.pdf  →  404
{"success":false,"error":{"message":"No ProofPay endpoint matches GET /uploads/…"}}
```

Uploads were written to `backend/uploads` on a free Render instance, where the
filesystem is ephemeral — every redeploy and every wake from the 15-minute idle
sleep starts it empty. Five deploys had gone out that day. The proof had been
unreachable for hours.

**Why nothing said so.** Because nothing was broken from the record's point of
view. The Evidence documents live in MongoDB, so the type, the size, the
timestamp, the condition, the confidence and the engine's sentence all survived
and all rendered perfectly. The vault was not showing a stale page; it was
faithfully describing a file it no longer had. A missing artefact had no way to
report itself — there was no request that would have failed until somebody
clicked a link.

Which is the worst available failure for this particular product. ProofPay's
claim is that a promise can be proven on demand, and the demonstration of that
claim was a list of proof that could not be produced.

**The fix.** The bytes moved to where the record already was:

- `StoredFile` holds the file in MongoDB, in its own collection so that listing
  the vault never drags a megabyte of PDF through the query. `MAX_UPLOAD_MB` is
  10, comfortably inside the 16MB document ceiling.
- Multer switched from `diskStorage` to `memoryStorage`. Nothing is written to
  disk, so there is no longer a copy whose lifetime differs from the record's.
- Served from `/api/files/:token`, where the token is 16 random bytes. It is
  unauthenticated exactly as the old static paths were — the unguessable name
  *is* the capability — and an ObjectId would have quietly given that up, being
  a timestamp and a counter.
- Withdrawn proof takes its bytes with it. On a disk nobody sweeps an orphan is
  litter; in a 512MB free tier it is quota.

Profile pictures had the same bug for the same reason and were fixed in the same
change: they shared the multer storage.

**The part that could have been worse.** The engine read uploads by path, from
that same directory — `readTextEvidence` and `readViewableEvidence` both took a
filename and went to the filesystem. Moving storage without moving them would
have left every re-read handing the model a file it could not open, capping
confidence at 60 for want of contents, and reporting it as a weak proof. That is
**incident 1 exactly**, arrived at from a new direction. Both readers now take
`{ buffer, mimetype }`, so a fresh upload and a re-read of a year-old artefact
are the same thing to them, and a test asserts that an uploaded document's text
is extracted rather than its name.

**The general form.** *A record and the thing it describes must not have
different lifetimes.* The row and the file were both "stored", in two systems
with nothing in common but a string — and the durable half went on narrating the
volatile half long after it was gone, in complete sentences, with a confidence
score. **Metadata that outlives its subject does not degrade into silence; it
degrades into fiction**, and fiction reads exactly like a working feature.

---

## The pattern

All seven were misdiagnosed the same way: **the loudest signal named the wrong
component.** A low score blamed the scoring. A network error blamed the network.
A low accuracy blamed the model. A busy provider blamed the bill. A rejected key
blamed the key. A sign-in that ended on `localhost` blamed the build. A vault
showing no artefacts blamed the preview.

In each case the fix came from working backwards from a number that could be
derived — `0.18 × 0.6 = 10%`, `7/12 = 58%`, `2ms ≠ unreachable`,
`700 + 1400 = 2.1s`, `403 ≠ 401` — rather than from the component the message
pointed at.

Two of them add something the first three do not. The fourth was found by
disbelieving a diagnosis *this file had already made* — the previous incident's
conclusion was the most convenient explanation available, and it was wrong the
second time. The fifth was found by disbelieving **the vendor's own error
message**, which was accurate in every detail and still pointed at the wrong
thing: OpenAI was right that it had not issued the key, and that fact said
nothing about whether the key was good.

The sixth is the only one where nothing failed. Every component did its job:
Google honoured a registered redirect URI, the local server completed a valid
exchange, the deployed server sent the address it had been configured with. The
bug lived entirely in the gap between two lines of the same file, and the only
observer positioned to see it was the one that knew which port belonged to which
process.

The seventh is the only one where the *interface was telling the truth about
the wrong thing*. Every field it displayed was accurate; the subject of those
fields had ceased to exist. It is the sharpest version of the theme, because
there was no error anywhere to find — the component reporting on the file could
see everything except the file.

The recurring lesson across all seven is narrower than "check your assumptions".
It is that **a component reporting a failure is reporting what it can see**, and
what it can see is bounded by what it was told. The scoring could not see the
prompt. The browser could not see the connection pool. The retry loop could not
see the difference between busy and metered. OpenAI could not see that the key
belonged to somebody else. Every one of these was solved by finding the observer
with the wider view — and, in the last two, by giving the code the vocabulary to
describe a state it previously had no word for.
