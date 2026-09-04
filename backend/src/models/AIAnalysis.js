import mongoose from 'mongoose';

/** Every Proof Engine call is written down. */

/** The engines that exist without anyone configuring a gateway. */
const KNOWN_ENGINES = ['openai', 'anthropic', 'gemini', 'local-engine'];

/** A bare host, which is how a gateway names itself: `tabitoken.com`. */
const GATEWAY_HOST =
  /^(?=.{1,253}$)(localhost|[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,})(:\d{1,5})?$/i;

/** Who produced a reading, as a closed vocabulary plus one open case. */
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
