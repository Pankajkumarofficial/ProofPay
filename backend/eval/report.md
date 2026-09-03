# Proof Engine evaluation

Generated 2026-09-03 11:08 · 12 ambiguity cases · 11 parse cases · 12 evidence cases

Both engines are scored against the same hand-labelled set. The labels were
written before either engine ran, and several cases are ones the
deterministic engine is expected to win.

**The number that matters is false accepts.** ProofPay releases money only
when a promise is proven, so waving through a claim with no artefact behind
it is the expensive error — an engine that scores well overall while making
those is worse than one that does not.

## Evidence assessment

| Engine | Accuracy | Precision | Recall | **False accepts** | False refusals |
|---|---|---|---|---|---|
| Local engine (rules) | 92% | 100% | 80% | **0** | 1 |
| integrate.api.nvidia.com · google/diffusiongemma-26b-a4b-it | 58% | 0% | 0% | **0** | 5 |

*Precision here is: of the proofs an engine accepted, how many were real.*

### Local engine (rules) — case by case

| Case | Expected | Decided | Verdict | Conf | |
|---|---|---|---|---|---|
| bare claim, no artefact | REFUSE | REFUSE | INSUFFICIENT | 40% | ✓ |
| test claim with no report | REFUSE | REFUSE | INSUFFICIENT | 52% | ✓ |
| screenshot named but not inspectable | REFUSE | REFUSE | INSUFFICIENT | 44% | ✓ |
| unrelated artefact | REFUSE | REFUSE | INSUFFICIENT | 42% | ✓ |
| promise of future work | REFUSE | REFUSE | INSUFFICIENT | 40% | ✓ |
| payment claim with no reference | REFUSE | REFUSE | INSUFFICIENT | 45% | ✓ |
| contradicts the condition | REFUSE | REFUSE | CONTRADICTS | 52% | ✓ |
| deployed URL for a delivery condition | ACCEPT | ACCEPT | SUPPORTS | 88% | ✓ |
| CI run link for a test condition | ACCEPT | ACCEPT | SUPPORTS | 75% | ✓ |
| invoice document for a settlement condition | ACCEPT | ACCEPT | SUPPORTS | 83% | ✓ |
| tagged release for a publish condition | ACCEPT | ACCEPT | SUPPORTS | 78% | ✓ |
| delivery confirmation with a tracking reference | ACCEPT | REFUSE | INSUFFICIENT | 61% | ✗ |

### integrate.api.nvidia.com · google/diffusiongemma-26b-a4b-it — case by case

| Case | Expected | Decided | Verdict | Conf | |
|---|---|---|---|---|---|
| bare claim, no artefact | REFUSE | REFUSE | INSUFFICIENT | 100% | ✓ |
| test claim with no report | REFUSE | REFUSE | INSUFFICIENT | 60% | ✓ |
| screenshot named but not inspectable | REFUSE | REFUSE | INSUFFICIENT | 0% | ✓ |
| unrelated artefact | REFUSE | REFUSE | INSUFFICIENT | 60% | ✓ |
| promise of future work | REFUSE | REFUSE | INSUFFICIENT | 100% | ✓ |
| payment claim with no reference | REFUSE | REFUSE | INSUFFICIENT | 100% | ✓ |
| contradicts the condition | REFUSE | REFUSE | CONTRADICTS | 100% | ✓ |
| deployed URL for a delivery condition | ACCEPT | REFUSE | INSUFFICIENT | 60% | ✗ |
| CI run link for a test condition | ACCEPT | REFUSE | INSUFFICIENT | 60% | ✗ |
| invoice document for a settlement condition | ACCEPT | REFUSE | INSUFFICIENT | 60% | ✗ |
| tagged release for a publish condition | ACCEPT | REFUSE | INSUFFICIENT | 60% | ✗ |
| delivery confirmation with a tracking reference | ACCEPT | REFUSE | INSUFFICIENT | 60% | ✗ |

## Ambiguity detection

| Engine | Vague phrases caught | False alarms on clear promises |
|---|---|---|
| Local engine (rules) | 7/8 | 0/4 |
| integrate.api.nvidia.com · google/diffusiongemma-26b-a4b-it | 8/8 | 1/4 |

## Parsing a sentence into a payable structure

| Engine | Amount | Recipient | Condition count |
|---|---|---|---|
| Local engine (rules) | 11/11 | 11/11 | 9/11 |
| integrate.api.nvidia.com · google/diffusiongemma-26b-a4b-it | 11/11 | 11/11 | 10/11 |

## Runtime

| Engine | Wall clock |
|---|---|
| Local engine (rules) | 0.0s |
| integrate.api.nvidia.com · google/diffusiongemma-26b-a4b-it | 109.9s |

The deterministic engine is effectively instant and free. That is why it is
the fallback rather than a stub: when a model call fails, ProofPay keeps
working, and the interface says which engine answered.
