import mongoose from 'mongoose';

/**
 * Every Proof Engine call is written down: what went in, what came back, whether
 * the response passed schema validation, and which engine produced it. Nothing
 * reaches the rest of the database until the matching record says `valid: true`.
 */
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
    engine: { type: String, enum: ['claude', 'local-engine'], required: true },
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
