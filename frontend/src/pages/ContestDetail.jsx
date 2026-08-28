import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Cpu, Gavel, MessageSquarePlus, Scale } from 'lucide-react';
import { Button } from '../components/UI/Button.jsx';
import { Panel } from '../components/UI/Panel.jsx';
import { Modal } from '../components/UI/Modal.jsx';
import { Select, Textarea } from '../components/UI/Field.jsx';
import { EngineBadge } from '../components/UI/EngineBadge.jsx';
import { EvidenceItem } from '../components/EvidenceVault/EvidenceItem.jsx';
import { Loading, ErrorState } from '../components/UI/States.jsx';
import { useApi } from '../hooks/useApi.js';
import { disputeApi } from '../services/disputeApi.js';
import { useToast } from '../context/ToastContext.jsx';
import { formatMoney, relativeTime, titleFromEnum } from '../utils/format.js';

const OUTCOMES = [
  { value: 'released', label: 'Release to the recipient' },
  { value: 'refunded', label: 'Refund the payer' },
  { value: 'dismissed', label: 'Dismiss the contest' },
  { value: 'withdrawn', label: 'Withdraw (only the person who raised it)' },
];

function ListBlock({ title, items, tone = 'text-paper-200' }) {
  if (!items?.length) return null;
  return (
    <div>
      <p className="eyebrow">{title}</p>
      <ul className="mt-2 space-y-1.5">
        {items.map((item, index) => (
          <li key={index} className={`flex gap-2 text-[13px] leading-relaxed ${tone}`}>
            <span className="text-paper-400">·</span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ContestDetail() {
  const { id } = useParams();
  const toast = useToast();
  const [claimOpen, setClaimOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [analysing, setAnalysing] = useState(false);

  const contest = useApi(() => disputeApi.get(id), [id]);

  const dispute = contest.data?.dispute;
  const evidence = contest.data?.evidence ?? [];
  const canResolve = contest.data?.permissions?.canResolve;

  const analyse = async () => {
    setAnalysing(true);
    try {
      const result = await disputeApi.analyse(id);
      toast.info(
        `Proof Engine recommends: ${titleFromEnum(result.analysis.recommendedOutcome)}`,
        result.analysis.summary
      );
      contest.refresh();
    } catch (error) {
      toast.error('The contest could not be analysed', error.message);
    } finally {
      setAnalysing(false);
    }
  };

  if (contest.loading) return <Loading label="Loading contest…" className="min-h-[60vh]" />;
  if (contest.error) return <ErrorState error={contest.error} onRetry={contest.reload} className="min-h-[60vh]" />;

  const analysis = dispute.analysis?.analysedAt ? dispute.analysis : null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-8">
      <Link to="/contests" className="btn-quiet -ml-3 mb-4">
        <ArrowLeft size={13} strokeWidth={1.75} /> Contests
      </Link>

      <header className="border-b border-ink-300/60 pb-6">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="flex items-center gap-1.5 border border-rust-400/40 bg-rust-400/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-rust-300">
            <Scale size={11} strokeWidth={1.75} /> {titleFromEnum(dispute.status)}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-paper-400">{dispute.publicId}</span>
        </div>

        <h1 className="mt-3 font-display text-[26px] leading-tight text-paper-50">{dispute.promise?.title}</h1>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] uppercase tracking-wider text-paper-400">
          <span className="tnum text-paper-200">
            {formatMoney(dispute.promise?.amount, dispute.promise?.currency)} held
          </span>
          <span aria-hidden>·</span>
          <span>raised by {dispute.raisedBy?.name}</span>
          <span aria-hidden>·</span>
          <span>{relativeTime(dispute.createdAt)}</span>
          <span aria-hidden>·</span>
          <Link to={`/promises/${dispute.promise?._id}`} className="text-brass-200 hover:text-brass-100">
            Open the promise
          </Link>
        </p>

        <p className="mt-4 max-w-2xl border-l-2 border-rust-400/40 pl-3.5 text-[14px] leading-relaxed text-paper-100">
          {dispute.reason}
        </p>

        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="ghost" icon={Cpu} loading={analysing} onClick={analyse}>
            {analysis ? 'Re-read the record' : 'Ask the Proof Engine'}
          </Button>
          <Button variant="ghost" icon={MessageSquarePlus} onClick={() => setClaimOpen(true)}>
            File a statement
          </Button>
          {dispute.status !== 'RESOLVED' && dispute.status !== 'WITHDRAWN' ? (
            <Button variant="primary" icon={Gavel} onClick={() => setResolveOpen(true)}>
              Resolve
            </Button>
          ) : null}
        </div>
      </header>

      <div className="mt-6 space-y-6">
        {analysis ? (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <Panel
              eyebrow="Proof Engine"
              title="What the record supports"
              action={<EngineBadge engine={dispute.analysis.engine} />}
            >
              <p className="wrap-pasted text-[13.5px] leading-relaxed text-paper-100">{analysis.summary}</p>

              <div className="mt-5 grid gap-5 sm:grid-cols-2">
                <ListBlock title="Fulfilled conditions" items={analysis.fulfilledConditions} tone="text-sage-300" />
                <ListBlock title="Contested conditions" items={analysis.contestedConditions} tone="text-rust-300" />
                <ListBlock title="Missing proof" items={analysis.missingProof} tone="text-ochre-300" />
                <ListBlock title="Contradictions" items={analysis.contradictions} tone="text-rust-300" />
              </div>

              <div className="mt-5 border border-ink-300 bg-ink-800/60 px-4 py-3.5">
                <p className="flex items-center justify-between gap-3">
                  <span className="eyebrow">Recommendation</span>
                  <span className="tnum font-mono text-[10px] text-paper-400">{analysis.confidence}% confidence</span>
                </p>
                <p className="mt-2 font-display text-[17px] text-paper-50">
                  {titleFromEnum(analysis.recommendedOutcome)}
                </p>
                <p className="mt-2 text-[13px] leading-relaxed text-paper-300">{analysis.recommendation}</p>
              </div>
            </Panel>
          </motion.div>
        ) : (
          <Panel eyebrow="Proof Engine" title="The record has not been read yet">
            <p className="text-[13px] leading-relaxed text-paper-300">
              The engine will lay out which conditions are proven, which are missing proof, and where the accounts
              contradict each other. It recommends; it never releases money.
            </p>
          </Panel>
        )}

        <Panel eyebrow="Statements" title={`${dispute.claims?.length ?? 0} filed`}>
          {dispute.claims?.length ? (
            <ol className="space-y-4">
              {dispute.claims.map((claim, index) => (
                <li key={claim._id ?? index} className="border-l-2 border-ink-300 pl-3.5">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-paper-400">
                    {claim.name} · {relativeTime(claim.createdAt)}
                  </p>
                  <p className="mt-1.5 text-[13.5px] leading-relaxed text-paper-100">{claim.statement}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-[13px] text-paper-400">No statements have been filed yet.</p>
          )}
        </Panel>

        {dispute.resolution?.outcome ? (
          <Panel eyebrow="Resolution" title={titleFromEnum(dispute.resolution.outcome)}>
            <p className="text-[13px] leading-relaxed text-paper-200">
              {dispute.resolution.note || 'No note was left.'}
            </p>
            <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-paper-400">
              {relativeTime(dispute.resolution.resolvedAt)}
            </p>
          </Panel>
        ) : null}

        <Panel eyebrow="Evidence Vault" title={`${evidence.length} items on this promise`} bodyClass="p-4 sm:p-5">
          {evidence.length ? (
            <div className="space-y-3">
              {evidence.map((item) => (
                <EvidenceItem key={item._id} evidence={item} />
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-paper-400">No proof was ever filed against this promise.</p>
          )}
        </Panel>
      </div>

      <ClaimModal open={claimOpen} onClose={() => setClaimOpen(false)} disputeId={id} onFiled={contest.refresh} />
      <ResolveModal
        open={resolveOpen}
        onClose={() => setResolveOpen(false)}
        dispute={dispute}
        canResolve={canResolve}
        onResolved={contest.refresh}
      />
    </div>
  );
}

function ClaimModal({ open, onClose, disputeId, onFiled }) {
  const toast = useToast();
  const [statement, setStatement] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (statement.trim().length < 5) return;
    setSaving(true);
    try {
      await disputeApi.addClaim(disputeId, { statement: statement.trim(), evidenceIds: [] });
      toast.success('Statement filed', 'It is now part of the record the engine reads.');
      setStatement('');
      onFiled();
      onClose();
    } catch (error) {
      toast.error('That statement could not be filed', error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Contest"
      title="File a statement"
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} onClick={submit}>
            File statement
          </Button>
        </>
      }
    >
      <Textarea
        label="Your account"
        rows={5}
        value={statement}
        onChange={(event) => setStatement(event.target.value)}
        placeholder="What happened, from your side. Be specific about dates and artefacts."
      />
    </Modal>
  );
}

function ResolveModal({ open, onClose, dispute, canResolve, onResolved }) {
  const toast = useToast();
  const [outcome, setOutcome] = useState('released');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await disputeApi.resolve(dispute._id, { outcome, note: note.trim() });
      toast.success('Contest resolved', titleFromEnum(outcome));
      onResolved();
      onClose();
    } catch (error) {
      toast.error('That resolution did not go through', error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow="Resolution"
      title="Resolve this contest"
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon={Gavel} loading={saving} onClick={submit}>
            Resolve
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {!canResolve ? (
          <p className="border border-ochre-400/40 bg-ochre-400/[0.06] px-3 py-2.5 text-[12px] leading-relaxed text-ochre-300">
            Only the payer can release or refund. If you raised this contest, you can still withdraw it.
          </p>
        ) : null}

        <Select
          label="Outcome"
          value={outcome}
          onChange={(event) => setOutcome(event.target.value)}
          options={OUTCOMES}
        />

        <p className="text-[13px] leading-relaxed text-paper-300">
          {outcome === 'released'
            ? `${formatMoney(dispute.promise?.amount, dispute.promise?.currency)} moves to the recipient and the promise is marked fulfilled.`
            : outcome === 'refunded'
              ? `${formatMoney(dispute.promise?.amount, dispute.promise?.currency)} returns to the payer and the promise is cancelled.`
              : outcome === 'withdrawn'
                ? 'The contest closes and the promise resumes from its record.'
                : 'The contest closes without moving money; the promise resumes from its record.'}
        </p>

        <Textarea
          label="Note for the Chronicle"
          rows={3}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Why this outcome?"
        />
      </div>
    </Modal>
  );
}
