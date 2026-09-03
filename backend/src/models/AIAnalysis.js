import mongoose from 'mongoose';

/**
 * Every Proof Engine call is written down: what went in, what came back, whether
 * the response passed schema validation, and which engine produced it. Nothing
 * reaches the rest of the database until the matching record says `valid: true`.
 */

/** The engines that exist without anyone configuring a gateway. */
const KNOWN_ENGINES = ['openai', 'anthropic', 'gemini', 'local-engine'];

/**
 * A bare host, which is how a gateway names itself: `tabitoken.com`.
 *
 * The final label must be alphabetic, and that is not pedantry about DNS — a
 * looser pattern accepts `gpt-4.1-mini`, and a model name sitting in the engine
 * column is the exact misattribution this field exists to prevent. A port is
 * allowed so that a self-hosted proxy on `localhost:4000` can be recorded as
 * what it is.
 */
const GATEWAY_HOST =
  /^(?=.{1,253}$)(localhost|[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,})(:\d{1,5})?$/i;

/**
 * Who produced a reading, as a closed vocabulary plus one open case.
 *
 * The four above are the whole world until `AI_BASE_URL` points somewhere, and a
 * gateway can be any host — so this cannot be a fixed enum without either
 * rejecting every gateway or recording it under the name of the vendor whose
 * wire format it borrowed. Both are worse than the rule used here: a known
 * engine, or something shaped like a host. Free text is still refused, which is
 * what the constraint was really guarding — a label that could quietly claim a
 * vendor that was never involved.
 */
const isAttributableEngine = (value) => KNOWN_ENGINES.includes(value) || GATEWAY_HOST.test(value);
const aiAnalysisSchema = new mongoose.Schema(
  {
    kind: {
      type: String,
      enum: [
        'PROMISE_PARSE',
        'AMBIGUITY_SCAN',
        'EVIDENCE_VERIFICATION',
        'DISPUTE_ANALYSIS',
        'EXPLANATION',
      ],
      required: true,
      index: true,
    },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    promise: { type: mongoose.Schema.Types.ObjectId, ref: 'Promise', default: null, index: true },
    condition: { type: mongoose.Schema.Types.ObjectId, ref: 'Condition', default: null },
    evidence: { type: mongoose.Schema.Types.ObjectId, ref: 'Evidence', default: null },
    dispute: { type: mongoose.Schema.Types.ObjectId, ref: 'Dispute', default: null },

    input: { type: String, default: '' },
    output: { type: mongoose.Schema.Types.Mixed, default: null },
    /** Whoever actually produced this reading — never assumed, always recorded. */
    engine: {
      type: String,
      required: true,
      validate: {
        validator: isAttributableEngine,
        message: ({ value }) => `"${value}" is neither a known engine nor a gateway host.`,
      },
    },
    model: { type: String, default: null },
    confidence: { type: Number, min: 0, max: 100, default: 0 },
    latencyMs: { type: Number, default: 0 },
    attempts: { type: Number, default: 1 },
    valid: { type: Boolean, default: false },
    error: { type: String, default: null },
  },
  { timestamps: true }
);

export const AIAnalysis = mongoose.model('AIAnalysis', aiAnalysisSchema);
