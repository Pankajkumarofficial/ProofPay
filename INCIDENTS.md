# What broke, and how we got out

Three failures worth writing down. Each was diagnosed wrongly at least once,
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

## The pattern

All three were misdiagnosed the same way: **the loudest signal named the wrong
component.** A low score blamed the scoring. A network error blamed the network.
A low accuracy blamed the model.

In each case the fix came from working backwards from a number that could be
derived — `0.18 × 0.6 = 10%`, `7/12 = 58%`, `2ms ≠ unreachable` — rather than
from the component the message pointed at.
