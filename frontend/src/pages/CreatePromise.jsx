import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Cpu, Plus, Trash2, ArrowRight, ArrowLeft, Wand2 } from 'lucide-react';
import { Button } from '../components/UI/Button.jsx';
import { Input, Select, Textarea } from '../components/UI/Field.jsx';
import { EngineBadge } from '../components/UI/EngineBadge.jsx';
import { AmbiguityResolver } from '../components/ProofEngine/AmbiguityResolver.jsx';
import { proofEngineApi } from '../services/proofEngineApi.js';
import { promiseApi } from '../services/promiseApi.js';
import { useToast } from '../context/ToastContext.jsx';
import { CONDITION_TYPES, VERIFICATION_METHODS, CURRENCIES } from '../utils/status.js';
import { formatMoney } from '../utils/format.js';

const EXAMPLES = [
  "I'll pay Rahul ₹10,000 when he delivers the website, all five acceptance tests pass, and I approve the final version.",
  'Pay Sarah ₹35,000 when she delivers the brand film in 4K and both revision rounds are approved.',
  'Pay him ₹5,000 when the work is good.',
];

const blankCondition = () => ({
  description: '',
  type: 'deliverable',
  verificationMethod: 'ai_assessment',
  requiredEvidence: [],
  weight: 1,
});

export function CreatePromise() {
  const navigate = useNavigate();
  const toast = useToast();

  const [stage, setStage] = useState('intent'); // intent | draft
  const [text, setText] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [engine, setEngine] = useState(null);

  const [draft, setDraft] = useState(null);
  const [resolved, setResolved] = useState({});
  const [errors, setErrors] = useState({});

  const understand = async () => {
    if (text.trim().length < 10) {
      setErrors({ text: 'Describe the promise in a sentence or two.' });
      return;
    }
    setErrors({});
    setParsing(true);
    try {
      const result = await proofEngineApi.parsePromise(text.trim(), currency);
      setEngine({ engine: result.engine, model: result.model });
      setDraft({
        title: result.draft.title,
        amount: result.draft.amount ?? '',
        currency: result.draft.currency ?? currency,
        recipientName: result.draft.recipient ?? '',
        recipientEmail: '',
        outcome: result.draft.outcome ?? '',
        purpose: result.draft.purpose ?? '',
        deadline: result.draft.deadline ? result.draft.deadline.slice(0, 10) : '',
        conditions: result.draft.conditions.map((condition) => ({ ...condition, weight: 1 })),
        ambiguities: result.draft.ambiguities ?? [],
      });
      setResolved({});
      setStage('draft');
      if (result.needsResolution) {
        toast.warning(
          'Some of this cannot be verified as written',
          'The Proof Engine flagged phrases that no evidence could settle. Pick what would.'
        );
      }
    } catch (error) {
      toast.error('The Proof Engine could not read that', error.message);
    } finally {
      setParsing(false);
    }
  };

  const resolveAmbiguity = (ambiguity, choice) => {
    setResolved((current) => ({ ...current, [ambiguity.phrase]: choice }));
    setDraft((current) => ({
      ...current,
      conditions: [
        ...current.conditions,
        {
          description: choice,
          type: /approv|sign|accept/i.test(choice) ? 'approval' : /test|threshold|score/i.test(choice) ? 'test' : 'quality',
          verificationMethod: /approv|sign|accept/i.test(choice) ? 'manual_approval' : 'ai_assessment',
          requiredEvidence: [],
          weight: 1,
        },
      ],
    }));
  };

  const updateCondition = (index, patch) =>
    setDraft((current) => ({
      ...current,
      conditions: current.conditions.map((condition, position) =>
        position === index ? { ...condition, ...patch } : condition
      ),
    }));

  const validate = () => {
    const found = {};
    if (!draft.title || draft.title.trim().length < 3) found.title = 'Give this promise a title.';
    if (!draft.amount || Number(draft.amount) <= 0) found.amount = 'Enter the amount you are committing.';
    if (!draft.recipientName || draft.recipientName.trim().length < 2) found.recipientName = 'Who is being paid?';
    if (draft.recipientEmail && !/^\S+@\S+\.\S+$/.test(draft.recipientEmail)) {
      found.recipientEmail = 'That email does not look right.';
    }
    const blank = draft.conditions.findIndex((condition) => condition.description.trim().length < 3);
    if (!draft.conditions.length) found.conditions = 'A promise needs at least one condition.';
    else if (blank !== -1) found.conditions = `Condition ${String(blank + 1).padStart(2, '0')} needs a description.`;
    setErrors(found);
    return Object.keys(found).length === 0;
  };

  const create = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const result = await promiseApi.create({
        title: draft.title.trim(),
        description: draft.outcome?.trim() ?? '',
        sourceText: text.trim(),
        purpose: draft.purpose ?? '',
        outcome: draft.outcome ?? '',
        amount: Number(draft.amount),
        currency: draft.currency,
        recipient: {
          name: draft.recipientName.trim(),
          email: draft.recipientEmail.trim() || null,
        },
        deadline: draft.deadline ? new Date(`${draft.deadline}T17:00:00`).toISOString() : null,
        conditions: draft.conditions.map((condition) => ({
          description: condition.description.trim(),
          type: condition.type,
          verificationMethod: condition.verificationMethod,
          requiredEvidence: condition.requiredEvidence ?? [],
          weight: condition.weight ?? 1,
        })),
        ambiguityFlags: (draft.ambiguities ?? []).map((ambiguity) => ({
          phrase: ambiguity.phrase,
          reason: ambiguity.reason,
          suggestions: ambiguity.suggestions ?? [],
          resolved: Boolean(resolved[ambiguity.phrase]),
        })),
      });
      toast.success('Promise created', `${result.promise.publicId} is in your Promise Space.`);
      navigate(`/promises/${result.promise._id}`);
    } catch (error) {
      const fields = error.fieldErrors ?? {};
      setErrors(fields);
      toast.error('That promise could not be created', error.message);
    } finally {
      setSaving(false);
    }
  };

  const unresolved = (draft?.ambiguities ?? []).filter((ambiguity) => !resolved[ambiguity.phrase]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8">
      <p className="eyebrow">New promise</p>
      <h1 className="mt-1.5 font-display text-[28px] leading-tight text-paper-50">
        {stage === 'intent' ? 'What are you willing to pay for?' : 'Check what the engine understood.'}
      </h1>
      <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-paper-300">
        {stage === 'intent'
          ? 'Write it the way you would say it. The Proof Engine finds the amount, the recipient and the conditions that would have to be true.'
          : 'Everything here is editable. Nothing is committed until you create the promise, and no money moves until you fund it.'}
      </p>

      <AnimatePresence mode="wait">
        {stage === 'intent' ? (
          <motion.div key="intent" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-7">
            <div className="panel p-5">
              <Textarea
                label="The promise, in your words"
                rows={5}
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="I'll pay… when…"
                error={errors.text}
              />
              <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
                <Select
                  label="Currency"
                  value={currency}
                  onChange={(event) => setCurrency(event.target.value)}
                  options={CURRENCIES.map((code) => ({ value: code, label: code }))}
                  className="w-32"
                  hint="If unstated"
                />
                <Button variant="primary" size="lg" icon={Cpu} loading={parsing} onClick={understand}>
                  {parsing ? 'Reading…' : 'Understand this'}
                </Button>
              </div>
            </div>

            <div className="mt-6">
              <p className="eyebrow">Try one of these</p>
              <div className="mt-2.5 space-y-2">
                {EXAMPLES.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => setText(example)}
                    className="block w-full border border-ink-300/70 bg-ink-700/40 px-4 py-3 text-left text-[13px] leading-relaxed text-paper-300 transition-colors hover:border-brass-300/40 hover:text-paper-100"
                  >
                    “{example}”
                  </button>
                ))}
              </div>
              <p className="mt-3 text-[12px] leading-relaxed text-paper-400">
                The third one is deliberately unverifiable — try it and see what the engine refuses to accept.
              </p>
            </div>
          </motion.div>
        ) : (
          <motion.div key="draft" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-7 space-y-5">
            <div className="flex items-center justify-between">
              <Button variant="quiet" size="sm" icon={ArrowLeft} onClick={() => setStage('intent')}>
                Back to the sentence
              </Button>
              {engine ? <EngineBadge engine={engine.engine} model={engine.model} /> : null}
            </div>

            {unresolved.length ? (
              <AmbiguityResolver ambiguities={draft.ambiguities} onResolve={resolveAmbiguity} resolved={resolved} />
            ) : null}

            <div className="panel p-5">
              <Input
                label="Title"
                required
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                error={errors.title}
              />

              <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_7rem]">
                <Input
                  label="Amount"
                  required
                  type="number"
                  min="1"
                  step="0.01"
                  value={draft.amount}
                  onChange={(event) => setDraft({ ...draft, amount: event.target.value })}
                  error={errors.amount}
                  hint={draft.amount ? formatMoney(Number(draft.amount), draft.currency) : 'Not stated in your sentence'}
                />
                <Select
                  label="Currency"
                  value={draft.currency}
                  onChange={(event) => setDraft({ ...draft, currency: event.target.value })}
                  options={CURRENCIES.map((code) => ({ value: code, label: code }))}
                />
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Input
                  label="Paid to"
                  required
                  value={draft.recipientName}
                  onChange={(event) => setDraft({ ...draft, recipientName: event.target.value })}
                  error={errors.recipientName}
                />
                <Input
                  label="Their email"
                  type="email"
                  hint="Links their ProofPay account"
                  value={draft.recipientEmail}
                  onChange={(event) => setDraft({ ...draft, recipientEmail: event.target.value })}
                  error={errors.recipientEmail}
                />
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Input
                  label="Deadline"
                  type="date"
                  hint="Optional"
                  value={draft.deadline}
                  onChange={(event) => setDraft({ ...draft, deadline: event.target.value })}
                />
                <Input
                  label="Outcome that justifies payment"
                  value={draft.outcome}
                  onChange={(event) => setDraft({ ...draft, outcome: event.target.value })}
                />
              </div>
            </div>

            <div className="panel">
              <header className="flex items-center justify-between gap-4 border-b border-ink-300/60 px-5 py-3.5">
                <div>
                  <p className="eyebrow">Conditions</p>
                  <p className="mt-1 text-[13px] text-paper-100">
                    {draft.conditions.length} {draft.conditions.length === 1 ? 'condition' : 'conditions'} — each one a
                    node on the Promise Map
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Plus}
                  onClick={() => setDraft({ ...draft, conditions: [...draft.conditions, blankCondition()] })}
                >
                  Add
                </Button>
              </header>

              <div className="divide-y divide-ink-300/50">
                {draft.conditions.map((condition, index) => (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-5"
                  >
                    <div className="flex items-start gap-3">
                      <span className="tnum mt-2.5 font-mono text-[11px] text-brass-300">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <div className="min-w-0 flex-1 space-y-3">
                        <Textarea
                          rows={2}
                          value={condition.description}
                          placeholder="What has to be true?"
                          onChange={(event) => updateCondition(index, { description: event.target.value })}
                        />
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Select
                            label="Kind"
                            value={condition.type}
                            onChange={(event) => updateCondition(index, { type: event.target.value })}
                            options={CONDITION_TYPES}
                          />
                          <Select
                            label="Settled by"
                            value={condition.verificationMethod}
                            onChange={(event) => updateCondition(index, { verificationMethod: event.target.value })}
                            options={VERIFICATION_METHODS}
                          />
                        </div>
                        <Input
                          label="Evidence that would settle it"
                          hint="Comma separated"
                          value={(condition.requiredEvidence ?? []).join(', ')}
                          onChange={(event) =>
                            updateCondition(index, {
                              requiredEvidence: event.target.value
                                .split(',')
                                .map((entry) => entry.trim())
                                .filter(Boolean),
                            })
                          }
                        />
                      </div>
                      {draft.conditions.length > 1 ? (
                        <button
                          type="button"
                          onClick={() =>
                            setDraft({
                              ...draft,
                              conditions: draft.conditions.filter((_, position) => position !== index),
                            })
                          }
                          className="mt-2 p-1 text-paper-400 transition-colors hover:text-rust-300"
                          aria-label={`Remove condition ${index + 1}`}
                        >
                          <Trash2 size={14} strokeWidth={1.6} />
                        </button>
                      ) : null}
                    </div>
                  </motion.div>
                ))}
              </div>

              {errors.conditions ? (
                <p className="border-t border-rust-400/30 bg-rust-400/5 px-5 py-2.5 text-[12px] text-rust-300">
                  {errors.conditions}
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-4 border border-ink-300/70 bg-ink-700/50 px-5 py-4">
              <div>
                <p className="eyebrow">You are committing</p>
                <p className="tnum mt-1.5 font-display text-[24px] text-paper-50">
                  {draft.amount ? formatMoney(Number(draft.amount), draft.currency) : '—'}
                </p>
                <p className="mt-1 text-[11px] text-paper-400">
                  Nothing is charged now. You fund the promise as a separate, deliberate step.
                </p>
              </div>
              <Button variant="primary" size="lg" icon={ArrowRight} loading={saving} onClick={create}>
                Create promise
              </Button>
            </div>

            {unresolved.length ? (
              <p className="flex items-start gap-2 text-[12px] leading-relaxed text-ochre-300">
                <Wand2 size={13} className="mt-0.5 shrink-0" strokeWidth={1.75} />
                {unresolved.length} ambiguous {unresolved.length === 1 ? 'phrase is' : 'phrases are'} still unresolved.
                You can create the promise anyway — the flag stays on the record and holds down its Proof Confidence
                until it is settled.
              </p>
            ) : null}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
