import { useMemo, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, Banknote, Send, Scale, Upload, Plus, Check, X, RefreshCw, Trash2, Clock, Users, Landmark,
} from 'lucide-react';
import { PromiseMap } from '../components/PromiseMap/PromiseMap.jsx';
import { PayoutDestination } from '../components/Payout/PayoutDestination.jsx';
import { SettleOverUpi } from '../components/Payout/SettleOverUpi.jsx';
import { ConfidenceDial } from '../components/ProofConfidence/ConfidenceDial.jsx';
import { HealthMeter } from '../components/PromiseHealth/HealthMeter.jsx';
import { ProofEnginePanel } from '../components/ProofEngine/ProofEnginePanel.jsx';
import { EvidenceItem } from '../components/EvidenceVault/EvidenceItem.jsx';
import { SubmitProof } from '../components/EvidenceVault/SubmitProof.jsx';
import { ChronicleFeed } from '../components/Chronicle/ChronicleFeed.jsx';
import { Button } from '../components/UI/Button.jsx';
import { Modal } from '../components/UI/Modal.jsx';
import { Input, Select, Textarea } from '../components/UI/Field.jsx';
import { StatusPill, ConditionPill } from '../components/UI/StatusPill.jsx';
import { Loading, ErrorState } from '../components/UI/States.jsx';
import { useApi } from '../hooks/useApi.js';
import { useLiveUpdates } from '../hooks/useLiveUpdates.js';
import { promiseApi } from '../services/promiseApi.js';
import { paymentApi, CheckoutDismissed } from '../services/paymentApi.js';
import { evidenceApi } from '../services/evidenceApi.js';
import { disputeApi } from '../services/disputeApi.js';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { formatMoney, formatDate, relativeTime, daysUntil } from '../utils/format.js';
import { CONDITION_TYPES, VERIFICATION_METHODS, statusMeta, describePayout } from '../utils/status.js';

const TABS = [
  { key: 'map', label: 'Promise Map' },
  { key: 'conditions', label: 'Conditions' },
  { key: 'proof', label: 'Proof' },
  { key: 'chronicle', label: 'Chronicle' },
];

export function PromiseDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();

  const [tab, setTab] = useState('map');
  const [selectedCondition, setSelectedCondition] = useState(null);
  const [proofOpen, setProofOpen] = useState(false);
  const [conditionOpen, setConditionOpen] = useState(false);
  const [fulfilOpen, setFulfilOpen] = useState(false);
  const [contestOpen, setContestOpen] = useState(false);
  const [payoutOpen, setPayoutOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [busy, setBusy] = useState(null);

  const detail = useApi(() => promiseApi.get(id), [id]);
  const chronicle = useApi(() => promiseApi.chronicle(id), [id]);

  const refreshAll = () => {
    detail.refresh();
    chronicle.refresh();
  };
  useLiveUpdates((event) => {
    if (!event?.data?.promiseId || event.data.promiseId === id) refreshAll();
  });

  const promise = detail.data?.promise;
  const conditions = detail.data?.conditions ?? [];
  const evidence = detail.data?.evidence ?? [];
  const verifications = detail.data?.verifications ?? [];
  const payment = detail.data?.payment;
  const disputes = detail.data?.disputes ?? [];
  const permissions = detail.data?.permissions ?? {};
  const payout = payment?.payout;
  const destination = promise?.recipient?.payoutDestination;
  // The server writes one sentence for everybody (it goes into notifications for both sides).
  const payoutSummary =
    payout?.failureReason || describePayout(payout, promise?.relation) || payout?.summary;

  const openDispute = useMemo(
    () => disputes.find((dispute) => ['OPEN', 'UNDER_REVIEW'].includes(dispute.status)),
    [disputes]
  );

  const remaining = promise?.deadline ? daysUntil(promise.deadline) : null;

  const run = async (key, work, success) => {
    setBusy(key);
    try {
      const result = await work();
      if (success) toast.success(...success(result));
      refreshAll();
      return result;
    } catch (error) {
      if (error instanceof CheckoutDismissed) toast.info('Payment cancelled', error.message);
      else toast.error('That did not go through', error.message);
      return null;
    } finally {
      setBusy(null);
    }
  };

  /** The deadline, changed in place. */
  const [editingDeadline, setEditingDeadline] = useState(false);
  const [draftDeadline, setDraftDeadline] = useState('');

  const openDeadline = () => {
    // A date input wants YYYY-MM-DD, and only the date half of an ISO stamp is that.
    setDraftDeadline(promise?.deadline ? new Date(promise.deadline).toISOString().slice(0, 10) : '');
    setEditingDeadline(true);
  };

  const saveDeadline = async (value) => {
    const changed = await run(
      'deadline',
      () => promiseApi.update(id, { deadline: value }),
      () => [value ? 'Deadline updated' : 'Deadline cleared', value ? formatDate(value) : 'This promise no longer runs out.']
    );
    if (changed) setEditingDeadline(false);
  };

  if (detail.loading) return <Loading label="Loading promise…" className="min-h-[70vh]" />;
  if (detail.error) return <ErrorState error={detail.error} onRetry={detail.reload} className="min-h-[70vh]" />;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-8 sm:py-8">
      <Link to="/space" className="btn-quiet -ml-3 mb-4">
        <ArrowLeft size={13} strokeWidth={1.75} /> Promise Space
      </Link>

      {/* Header */}
      <header className="flex flex-wrap items-start justify-between gap-5 border-b border-ink-300/60 pb-6">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <StatusPill status={promise.status} />
            <span className="datum text-[11.5px] text-paper-400">{promise.publicId}</span>
            <span className="label">You are the {promise.relation}</span>
          </div>
          <h1 className="wrap-pasted mt-3 text-balance font-display text-[27px] leading-tight text-paper-50 sm:text-[32px]">
            {promise.title}
          </h1>
          {promise.description ? (
            <p className="mt-2.5 max-w-2xl text-[13.5px] leading-relaxed text-paper-300">{promise.description}</p>
          ) : null}
          {promise.sourceText ? (
            <p className="mt-3 max-w-2xl border-l border-ink-300 pl-3 text-[12.5px] italic leading-relaxed text-paper-400">
              “{promise.sourceText}”
            </p>
          ) : null}

          <dl className="mt-5 flex flex-wrap gap-x-8 gap-y-3">
            <div>
              <dt className="label">Amount</dt>
              <dd className="tnum mt-1 font-display text-[22px] text-paper-50">
                {formatMoney(promise.amount, promise.currency)}
              </dd>
            </div>
            <div>
              <dt className="label">Paid to</dt>
              <dd className="mt-1.5 flex items-center gap-1.5 text-[13px] text-paper-100">
                <Users size={12} strokeWidth={1.6} className="text-paper-400" />
                {promise.recipient?.name}
              </dd>
              {/* The email is what links their account — without it this promise reaches nobody, so a missing one is worth offering to fix here rather than leaving the payer to rewrite the promise. */}
              {promise.recipient?.email ? (
                <dd className="mt-0.5 truncate text-[11px] text-paper-400">{promise.recipient.email}</dd>
              ) : permissions.canEdit ? (
                <dd className="mt-0.5">
                  <button
                    type="button"
                    onClick={() => setEmailOpen(true)}
                    className="label text-brass-200 hover:text-brass-100"
                  >
                    Add their email
                  </button>
                </dd>
              ) : (
                <dd className="mt-0.5 text-[11px] text-paper-400">No email on file</dd>
              )}
            </div>
            <div>
              <dt className="label">Deadline</dt>
              {editingDeadline ? (
                <dd className="mt-1.5 flex flex-wrap items-center gap-2">
                  <input
                    type="date"
                    value={draftDeadline}
                    autoFocus
                    onChange={(event) => setDraftDeadline(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') saveDeadline(draftDeadline || null);
                      if (event.key === 'Escape') setEditingDeadline(false);
                    }}
                    className="field w-[9.5rem] px-2 py-1 text-[13px]"
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={busy === 'deadline'}
                    onClick={() => saveDeadline(draftDeadline || null)}
                  >
                    Save
                  </Button>
                  <Button size="sm" variant="quiet" onClick={() => setEditingDeadline(false)}>
                    Cancel
                  </Button>
                  {promise.deadline ? (
                    <Button
                      size="sm"
                      variant="quiet"
                      disabled={busy === 'deadline'}
                      onClick={() => saveDeadline(null)}
                    >
                      Clear
                    </Button>
                  ) : null}
                </dd>
              ) : (
                <dd className="mt-1.5 flex items-center gap-1.5 text-[13px] text-paper-100">
                  <Clock size={12} strokeWidth={1.6} className="text-paper-400" />
                  {promise.deadline ? (
                    <>
                      {formatDate(promise.deadline)}
                      {/* A settled promise has no time left to run out. */}
                      {['SETTLING', 'FULFILLED', 'CANCELLED'].includes(promise.status) ? null : (
                        <span
                          className={
                            remaining < 0 ? 'text-rust-300' : remaining <= 3 ? 'text-ochre-300' : 'text-paper-400'
                          }
                        >
                          ({remaining < 0 ? `${Math.abs(remaining)}d overdue` : `${remaining}d left`})
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-paper-400">None set</span>
                  )}
                  {permissions.canEdit ? (
                    <button
                      type="button"
                      onClick={openDeadline}
                      className="ml-0.5 text-[12px] text-brass-200 underline-offset-2 hover:underline"
                    >
                      {promise.deadline ? 'Change' : 'Set one'}
                    </button>
                  ) : null}
                </dd>
              )}
            </div>
            <div>
              <dt className="label">Money</dt>
              <dd className="mt-1.5 text-[13px] text-paper-100">
                {payment
                  ? `${payment.status.toLowerCase()} through ${payment.provider}${
                      payment.providerReference ? `, ${payment.providerReference}` : ''
                    }`
                  : 'Not funded'}
              </dd>
              {/* Released is a decision; the payout is whether the money arrived. */}
              {payout?.status && (payout.status !== 'NOT_SENT' || payout.failureReason) ? (
                <dd
                  className={`mt-1 text-[11px] leading-relaxed ${
                    payout.status === 'processed'
                      ? 'text-sage-300'
                      : ['failed', 'reversed', 'rejected', 'cancelled', 'NOT_SENT'].includes(payout.status)
                        ? 'text-rust-300'
                        : 'text-paper-400'
                  }`}
                >
                  <span className="wrap-pasted">{payoutSummary}</span>
                  {/* A simulated rail is never allowed to read as a real one. */}
                  {payout.provider === 'simulated' ? (
                    <span className="ml-1.5 label text-paper-400">
                      · simulated
                    </span>
                  ) : null}
                </dd>
              ) : destination?.label ? (
                <dd className="mt-1 text-[11px] text-paper-400">Payout to {destination.label}</dd>
              ) : null}
            </div>
          </dl>
        </div>

        {/* Actions — every money action needs a person, deliberately */}
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[13rem]">
          {permissions.canFund ? (
            <Button
              variant="primary"
              icon={Banknote}
              loading={busy === 'fund'}
              onClick={() =>
                run('fund', () => paymentApi.fundWithCheckout({ promise, user }), (result) => [
                  'Promise funded',
                  `${formatMoney(result.payment.amount, result.payment.currency)} is now conditional.`,
                ])
              }
            >
              Fund {formatMoney(promise.amount, promise.currency, { compact: true })}
            </Button>
          ) : null}

          {permissions.canFulfil ? (
            <Button variant="primary" icon={Send} onClick={() => setFulfilOpen(true)}>
              Authorise fulfillment
            </Button>
          ) : null}

          {/* Set before it is needed: a release with nowhere to send is a bad surprise. */}
          {promise.relation !== 'witness' && promise.status !== 'FULFILLED' ? (
            <Button variant="quiet" icon={Landmark} onClick={() => setPayoutOpen(true)}>
              {destination?.label ? 'Change payout destination' : 'Add payout destination'}
            </Button>
          ) : null}

          {/* A payout can still be in flight, have failed, or never have been sent at all after a release — the last of which a destination now fixes. */}
          {payout?.id || ['failed', 'queued', 'pending', 'processing', 'NOT_SENT'].includes(payout?.status) ? (
            <Button
              variant="quiet"
              icon={RefreshCw}
              loading={busy === 'payout'}
              onClick={() =>
                run('payout', () => promiseApi.refreshPayout(promise._id), (result) => [
                  'Payout checked',
                  describePayout(result.payout, promise.relation) ??
                    result.payout?.summary ??
                    result.payout?.status,
                ])
              }
            >
              Check payout
            </Button>
          ) : null}

          <Button variant="ghost" icon={Upload} onClick={() => setProofOpen(true)} disabled={!conditions.length}>
            Submit proof
          </Button>

          {permissions.canContest && !openDispute ? (
            <Button variant="quiet" icon={Scale} onClick={() => setContestOpen(true)}>
              Contest this promise
            </Button>
          ) : null}

          {openDispute ? (
            <Link to={`/contests/${openDispute._id}`} className="btn-danger">
              <Scale size={13} strokeWidth={1.75} /> Open contest
            </Link>
          ) : null}

          {permissions.canEdit ? (
            <Button
              variant="quiet"
              icon={Trash2}
              loading={busy === 'cancel'}
              onClick={() => {
                if (!window.confirm('Cancel this promise? Any held amount is returned to you.')) return;
                run('cancel', () => promiseApi.cancel(promise._id), () => [
                  'Promise cancelled',
                  'Any held amount was returned.',
                ]).then(() => navigate('/space'));
              }}
            >
              Cancel promise
            </Button>
          ) : null}
        </div>
      </header>

      {/* A released UPI promise still needs the payer to actually send the money — and it is the payer who sends it, so this is theirs alone. */}
      {promise.relation === 'payer' && payout?.provider === 'upi-intent' && payout.status === 'pending' ? (
        <div className="mt-6">
          <SettleOverUpi promise={promise} payout={payout} onSettled={refreshAll} />
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0">
          <div className="flex gap-1 overflow-x-auto border-b border-ink-300/60">
            {TABS.map((entry) => (
              <button
                key={entry.key}
                type="button"
                onClick={() => setTab(entry.key)}
                className={`relative shrink-0 px-4 py-2.5 label transition-colors ${
                  tab === entry.key ? 'text-paper-50' : 'text-paper-400 hover:text-paper-200'
                }`}
              >
                {entry.label}
                {entry.key === 'proof' && evidence.length ? (
                  <span className="tnum ml-1.5 text-paper-400">{evidence.length}</span>
                ) : null}
                {entry.key === 'conditions' ? <span className="tnum ml-1.5 text-paper-400">{conditions.length}</span> : null}
                {tab === entry.key ? (
                  <motion.span layoutId="promise-tab" className="absolute inset-x-0 -bottom-px h-px bg-brass-300" />
                ) : null}
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="pt-5"
            >
              {tab === 'map' ? (
                <div className="border border-ink-300/60 bg-ink-900/40 p-2 sm:p-4">
                  <PromiseMap
                    promise={promise}
                    conditions={conditions}
                    evidence={evidence}
                    verifications={verifications}
                    selectedConditionId={selectedCondition?._id}
                    onSelectCondition={(condition) => {
                      setSelectedCondition(condition);
                      setTab('conditions');
                    }}
                  />
                </div>
              ) : null}

              {tab === 'conditions' ? (
                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-[13px] text-paper-300">
                      {conditions.filter((condition) => ['VERIFIED', 'WAIVED'].includes(condition.status)).length} of{' '}
                      {conditions.length} proven
                    </p>
                    {permissions.canEdit ? (
                      <Button variant="ghost" size="sm" icon={Plus} onClick={() => setConditionOpen(true)}>
                        Add condition
                      </Button>
                    ) : null}
                  </div>

                  <div className="divide-y divide-ink-300/50 border border-ink-300/60">
                    {conditions.map((condition, index) => {
                      const proof = evidence.filter(
                        (item) => String(item.condition?._id ?? item.condition) === String(condition._id)
                      );
                      const latest = verifications.find(
                        (item) => String(item.condition?._id ?? item.condition) === String(condition._id)
                      );
                      const settled = ['VERIFIED', 'WAIVED'].includes(condition.status);

                      return (
                        <div key={condition._id} className="p-4 sm:p-5">
                          <div className="flex items-start gap-3.5">
                            <span className="tnum mt-0.5 font-mono text-[11px] text-brass-300">
                              {String(index + 1).padStart(2, '0')}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1.5">
                                <p className="min-w-0 flex-1 text-[14px] leading-snug text-paper-50">
                                  {condition.description}
                                </p>
                                <span className="flex shrink-0 items-center gap-2">
                                  <ConditionPill status={condition.status} />
                                  {condition.confidence ? (
                                    <span className="tnum font-mono text-[10px] text-paper-400">
                                      {condition.confidence}%
                                    </span>
                                  ) : null}
                                </span>
                              </div>

                              {/* * Three separate facts about how this condition * gets settled, previously strung together on * middle dots and set in capitals — which made * them read as one long shout rather than as * something you could scan. */}
                              <p className="mt-1.5 text-[12.5px] leading-relaxed text-paper-400">
                                Settled by {condition.verificationMethod.replace(/_/g, ' ')}
                                {condition.requiredEvidence?.length
                                  ? `. Expects ${condition.requiredEvidence.join(', ')}`
                                  : ''}
                                .
                              </p>

                              {latest?.explanation ? (
                                <p className="mt-2.5 border-l-2 border-ink-300 pl-3 text-[12.5px] leading-relaxed text-paper-300">
                                  {latest.explanation}
                                </p>
                              ) : null}

                              <div className="mt-3 flex flex-wrap items-center gap-2">
                                <Button
                                  variant="quiet"
                                  size="sm"
                                  icon={Upload}
                                  onClick={() => {
                                    setSelectedCondition(condition);
                                    setProofOpen(true);
                                  }}
                                >
                                  {proof.length ? `Add proof (${proof.length})` : 'Submit proof'}
                                </Button>

                                {/* Confirming is the payer's decision: the recipient confirming their own condition would be the person being paid certifying that they should be. */}
                                {!settled && permissions.canConfirmConditions ? (
                                  <Button
                                    variant="quiet"
                                    size="sm"
                                    icon={Check}
                                    loading={busy === `confirm-${condition._id}`}
                                    onClick={() =>
                                      run(
                                        `confirm-${condition._id}`,
                                        () => promiseApi.confirmCondition(condition._id, true),
                                        () => ['Condition confirmed', condition.description.slice(0, 90)]
                                      )
                                    }
                                  >
                                    Confirm
                                  </Button>
                                ) : null}

                                {/* Saying a condition is *not* met costs whoever says it, so both sides may. */}
                                {!settled && permissions.canFlagConditions ? (
                                  <Button
                                    variant="quiet"
                                    size="sm"
                                    icon={X}
                                    loading={busy === `reject-${condition._id}`}
                                    onClick={() =>
                                      run(
                                        `reject-${condition._id}`,
                                        () => promiseApi.confirmCondition(condition._id, false),
                                        () => ['Recorded as not satisfied', condition.description.slice(0, 90)]
                                      )
                                    }
                                  >
                                    Not satisfied
                                  </Button>
                                ) : null}

                                {permissions.canEdit && !proof.length && conditions.length > 1 ? (
                                  <Button
                                    variant="quiet"
                                    size="sm"
                                    icon={Trash2}
                                    loading={busy === `remove-${condition._id}`}
                                    onClick={() =>
                                      run(
                                        `remove-${condition._id}`,
                                        () => promiseApi.removeCondition(condition._id),
                                        () => ['Condition removed', 'The Promise Map has been redrawn.']
                                      )
                                    }
                                  >
                                    Remove
                                  </Button>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {tab === 'proof' ? (
                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-[13px] text-paper-300">
                      {evidence.length} {evidence.length === 1 ? 'item' : 'items'} in this promise’s vault
                    </p>
                    <Button variant="ghost" size="sm" icon={Upload} onClick={() => setProofOpen(true)}>
                      Submit proof
                    </Button>
                  </div>
                  {evidence.length ? (
                    <div className="space-y-3">
                      {evidence.map((item) => (
                        <EvidenceItem
                          key={item._id}
                          evidence={item}
                          verifying={busy === `verify-${item._id}`}
                          onVerify={(target) =>
                            run(
                              `verify-${target._id}`,
                              () => evidenceApi.verify(target._id),
                              // The reading runs in the background.
                              () => [
                                'Sent to the Proof Engine',
                                'The verdict appears against this condition as soon as it is read.',
                              ]
                            )
                          }
                          onRemove={(target) => {
                            if (!window.confirm('Withdraw this proof?')) return;
                            run(`remove-${target._id}`, () => evidenceApi.remove(target._id), () => [
                              'Proof withdrawn',
                              'Scores have been recalculated.',
                            ]);
                          }}
                        />
                      ))}
                    </div>
                  ) : (
                    <p className="border border-dashed border-ink-300 px-5 py-10 text-center text-[13px] text-paper-400">
                      No proof has been filed yet. Nothing here is assumed — a condition stays unproven until
                      something demonstrates it.
                    </p>
                  )}
                </div>
              ) : null}

              {tab === 'chronicle' ? (
                <div className="border border-ink-300/60 px-4 py-4 sm:px-5">
                  {chronicle.loading ? (
                    <Loading label="Loading Chronicle…" />
                  ) : (
                    <ChronicleFeed entries={chronicle.data?.entries ?? []} />
                  )}
                </div>
              ) : null}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Instruments */}
        <aside className="space-y-5">
          <div className="panel engraved px-4 py-5">
            <ConfidenceDial value={promise.proofConfidence} caption={statusMeta(promise.status).description} />
          </div>

          <div className="panel engraved p-5">
            <HealthMeter health={promise.promiseHealth} />
          </div>

          <ProofEnginePanel promiseId={promise._id} promise={promise} onAct={() => setProofOpen(true)} />

          <div className="panel engraved p-5">
            <p className="label">Latest in the Chronicle</p>
            <div className="mt-3">
              <ChronicleFeed entries={(chronicle.data?.entries ?? []).slice(0, 4)} dense />
            </div>
            <button
              type="button"
              onClick={() => setTab('chronicle')}
              className="mt-3 label text-brass-200 hover:text-brass-100"
            >
              See all {chronicle.data?.entries?.length ?? 0} entries
            </button>
          </div>

          <Button variant="quiet" icon={RefreshCw} loading={detail.refreshing} onClick={refreshAll} className="w-full">
            Recalculate from the record
          </Button>
        </aside>
      </div>

      <RecipientEmailModal
        open={emailOpen}
        onClose={() => setEmailOpen(false)}
        promise={promise}
        onSaved={refreshAll}
      />

      <PayoutDestination
        open={payoutOpen}
        onClose={() => setPayoutOpen(false)}
        promise={promise}
        onSaved={refreshAll}
      />

      <SubmitProof
        open={proofOpen}
        onClose={() => setProofOpen(false)}
        promise={promise}
        conditions={conditions}
        defaultConditionId={selectedCondition?._id}
        onSubmitted={refreshAll}
      />

      <AddConditionModal
        open={conditionOpen}
        onClose={() => setConditionOpen(false)}
        promiseId={promise._id}
        onAdded={refreshAll}
      />

      <FulfilModal
        open={fulfilOpen}
        onClose={() => setFulfilOpen(false)}
        promise={promise}
        payment={payment}
        onFulfilled={refreshAll}
      />

      <ContestModal
        open={contestOpen}
        onClose={() => setContestOpen(false)}
        promise={promise}
        conditions={conditions}
        onOpened={(dispute) => navigate(`/contests/${dispute._id}`)}
      />
    </div>
  );
}

/** Adding the recipient's email to a promise written without one. */
function RecipientEmailModal({ open, onClose, promise, onSaved }) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const value = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(value)) {
      setError('That email does not look right.');
      return;
    }
    setSaving(true);
    try {
      await promiseApi.update(promise._id, { recipient: { email: value } });
      toast.success(
        'Email added',
        `${promise.recipient?.name} is linked to this promise by ${value}.`
      );
      onSaved();
      onClose();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      label="Recipient"
      title={`Where does ${promise.recipient?.name} read this?`}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} onClick={submit}>
            Save the email
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-[13px] leading-relaxed text-paper-300">
          This links their ProofPay account to the promise. Until it is set, they cannot see it, file
          proof against it, or contest it — and the money has nowhere to be justified to.
        </p>
        <Input
          label="Their email"
          type="email"
          required
          placeholder="name@example.com"
          value={email}
          error={error}
          onChange={(event) => {
            setEmail(event.target.value);
            setError(null);
          }}
        />
      </div>
    </Modal>
  );
}

function AddConditionModal({ open, onClose, promiseId, onAdded }) {
  const toast = useToast();
  const [values, setValues] = useState({
    description: '',
    type: 'deliverable',
    verificationMethod: 'ai_assessment',
    requiredEvidence: '',
  });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (values.description.trim().length < 3) return;
    setSaving(true);
    try {
      await promiseApi.addCondition(promiseId, {
        description: values.description.trim(),
        type: values.type,
        verificationMethod: values.verificationMethod,
        requiredEvidence: values.requiredEvidence
          .split(',')
          .map((entry) => entry.trim())
          .filter(Boolean),
        weight: 1,
      });
      toast.success('Condition added', 'It is now a node on the Promise Map.');
      setValues({ description: '', type: 'deliverable', verificationMethod: 'ai_assessment', requiredEvidence: '' });
      onAdded();
      onClose();
    } catch (error) {
      toast.error('That condition could not be added', error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      label="Promise Map"
      title="Add a condition"
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon={Plus} loading={saving} onClick={submit}>
            Add condition
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Textarea
          label="What has to be true?"
          required
          rows={3}
          value={values.description}
          onChange={(event) => setValues({ ...values, description: event.target.value })}
          placeholder="Something a specific artefact could settle."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Kind"
            value={values.type}
            onChange={(event) => setValues({ ...values, type: event.target.value })}
            options={CONDITION_TYPES}
          />
          <Select
            label="Settled by"
            value={values.verificationMethod}
            onChange={(event) => setValues({ ...values, verificationMethod: event.target.value })}
            options={VERIFICATION_METHODS}
          />
        </div>
        <Input
          label="Evidence that would settle it"
          hint="Comma separated"
          value={values.requiredEvidence}
          onChange={(event) => setValues({ ...values, requiredEvidence: event.target.value })}
        />
        <p className="text-[12px] leading-relaxed text-paper-400">
          Adding a condition lowers Proof Confidence until it is proven — the promise now requires more than it did.
        </p>
      </div>
    </Modal>
  );
}

function FulfilModal({ open, onClose, promise, payment, onFulfilled }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      const result = await promiseApi.fulfil(promise._id, note);
      const money = formatMoney(result.payment.amount, result.payment.currency);
      // Releasing is the decision; fulfilment is the money arriving.
      if (result.promise?.status === 'FULFILLED') {
        toast.success('Fulfilled', `${money} paid to ${promise.recipient.name}.`);
      } else {
        toast.success(
          'Released',
          `${money} released to ${promise.recipient.name}. ${
            result.payout?.summary ?? 'This promise is fulfilled once the payment is recorded.'
          }`
        );
      }
      onFulfilled();
      onClose();
    } catch (error) {
      toast.error('Fulfillment did not go through', error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      label="Fulfillment"
      title="Release the money"
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Not yet
          </Button>
          <Button variant="primary" icon={Send} loading={saving} onClick={submit}>
            Authorise fulfillment
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="border border-ink-300 bg-ink-800/60 px-4 py-4">
          <p className="label">You are releasing</p>
          <p className="tnum mt-2 font-display text-[30px] leading-none text-paper-50">
            {formatMoney(promise.amount, promise.currency)}
          </p>
          <p className="mt-2 text-[13px] text-paper-200">
            to {promise.recipient?.name}
            {promise.recipient?.email ? ` · ${promise.recipient.email}` : ''}
          </p>
          {payment ? (
            <p className="mt-1 label text-paper-400">
              {payment.provider} {payment.providerReference}, held since {relativeTime(payment.fundedAt)}
            </p>
          ) : null}
        </div>

        <p className="text-[13px] leading-relaxed text-paper-300">
          Every condition on this promise is proven. The Proof Engine assessed the evidence and recommended this, but
          it cannot release money — this authorisation is yours alone, and it is final.
        </p>

        <Textarea
          label="Note for the Chronicle"
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Optional"
        />
      </div>
    </Modal>
  );
}

function ContestModal({ open, onClose, promise, conditions, onOpened }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [statement, setStatement] = useState('');
  const [selected, setSelected] = useState([]);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (reason.trim().length < 10) {
      toast.warning('Say what is contested', 'A contest freezes money — the record needs to say why.');
      return;
    }
    setSaving(true);
    try {
      const result = await disputeApi.create({
        promiseId: promise._id,
        reason: reason.trim(),
        conditionIds: selected,
        statement: statement.trim(),
      });
      toast.warning('Promise contested', 'The money stays conditional until this is resolved.');
      onOpened(result.dispute);
      onClose();
    } catch (error) {
      toast.error('The contest could not be opened', error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      label="Contest"
      title="Contest this promise"
      width="max-w-xl"
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" icon={Scale} loading={saving} onClick={submit}>
            Open contest
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-[13px] leading-relaxed text-paper-300">
          Contesting freezes this promise. No money moves in either direction until it is resolved, and both sides can
          file statements and proof.
        </p>

        <Textarea
          label="What is being contested?"
          required
          rows={3}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Describe the disagreement, specifically."
        />

        <div>
          <p className="mb-2 label">Which conditions</p>
          <div className="space-y-1.5">
            {conditions.map((condition, index) => (
              <label key={condition._id} className="flex cursor-pointer items-start gap-2.5 border border-ink-300/60 px-3 py-2.5">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-rust-400"
                  checked={selected.includes(condition._id)}
                  onChange={(event) =>
                    setSelected((current) =>
                      event.target.checked
                        ? [...current, condition._id]
                        : current.filter((entry) => entry !== condition._id)
                    )
                  }
                />
                <span className="text-[13px] leading-snug text-paper-200">
                  <span className="label">
                    {String(index + 1).padStart(2, '0')} ·{' '}
                  </span>
                  {condition.description}
                </span>
              </label>
            ))}
          </div>
        </div>

        <Textarea
          label="Your statement"
          rows={3}
          value={statement}
          onChange={(event) => setStatement(event.target.value)}
          placeholder="Your account of what happened. The Proof Engine reads this alongside the record."
        />
      </div>
    </Modal>
  );
}
