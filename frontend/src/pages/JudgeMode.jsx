import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Sparkles, Check, ArrowRight, Play, Upload, Send, Cpu } from 'lucide-react';
import { Button } from '../components/UI/Button.jsx';
import { SubmitProof } from '../components/EvidenceVault/SubmitProof.jsx';
import { Loading, ErrorState } from '../components/UI/States.jsx';
import { StatusPill } from '../components/UI/StatusPill.jsx';
import { ConfidenceDial } from '../components/ProofConfidence/ConfidenceDial.jsx';
import { useApi } from '../hooks/useApi.js';
import { useLiveUpdates } from '../hooks/useLiveUpdates.js';
import { promiseApi } from '../services/promiseApi.js';
import { paymentApi, CheckoutDismissed } from '../services/paymentApi.js';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { formatMoney } from '../utils/format.js';

/**
 * Judge Mode.
 *
 * Not a slideshow: each stage reads the live state of a real promise in MongoDB
 * and every action here goes through the same API a normal user would hit. The
 * checkmarks are computed from the record, so they can only be earned.
 */
export function JudgeMode() {
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  const [selectedId, setSelectedId] = useState(null);
  const [proofOpen, setProofOpen] = useState(false);
  const [busy, setBusy] = useState(null);

  const list = useApi(() => promiseApi.list({ limit: 50, sort: 'recent' }), []);
  const promises = list.data?.promises ?? [];

  const focusId = selectedId ?? promises[0]?._id ?? null;
  const detail = useApi(() => (focusId ? promiseApi.get(focusId) : Promise.resolve(null)), [focusId], {
    immediate: Boolean(focusId),
  });

  useLiveUpdates(() => {
    list.refresh();
    if (focusId) detail.refresh();
  });

  const promise = detail.data?.promise;
  const conditions = detail.data?.conditions ?? [];
  const evidence = detail.data?.evidence ?? [];
  const payment = detail.data?.payment;
  const permissions = detail.data?.permissions ?? {};

  const stages = useMemo(() => {
    const verified = conditions.filter((condition) => ['VERIFIED', 'WAIVED'].includes(condition.status)).length;
    const assessed = evidence.filter((item) => item.confidence > 0).length;

    return [
      {
        key: 'create',
        title: 'Create promise',
        detail: promise ? `${promise.publicId} — ${promise.title}` : 'No promise yet',
        done: Boolean(promise),
      },
      {
        key: 'understand',
        title: 'The engine understands it',
        detail: promise?.sourceText
          ? `Read from: “${promise.sourceText.slice(0, 90)}${promise.sourceText.length > 90 ? '…' : ''}”`
          : 'Written directly, without a source sentence',
        done: Boolean(promise),
      },
      {
        key: 'conditions',
        title: 'Conditions created',
        detail: `${conditions.length} condition${conditions.length === 1 ? '' : 's'} on the Promise Map`,
        done: conditions.length > 0,
      },
      {
        key: 'funded',
        title: 'Money held conditionally',
        detail: payment
          ? `${formatMoney(payment.amount, payment.currency)} ${payment.status.toLowerCase()} · ${payment.provider}`
          : 'Not funded yet',
        done: Boolean(payment?.fundedAt),
        action: permissions.canFund
          ? {
              label: 'Fund it',
              icon: Play,
              run: () => paymentApi.fundWithCheckout({ promise, user }),
              success: 'The amount is now conditional.',
            }
          : null,
      },
      {
        key: 'proof',
        title: 'Proof submitted',
        detail: `${evidence.length} item${evidence.length === 1 ? '' : 's'} in the vault`,
        done: evidence.length > 0,
        action: promise
          ? { label: 'Submit proof', icon: Upload, open: () => setProofOpen(true) }
          : null,
      },
      {
        key: 'validated',
        title: 'The engine validates it',
        detail: `${assessed} assessment${assessed === 1 ? '' : 's'} recorded · ${verified}/${conditions.length} conditions proven`,
        done: assessed > 0,
      },
      {
        key: 'proven',
        title: 'Promise proven',
        detail: promise
          ? `Proof Confidence ${promise.proofConfidence}% · Promise Health ${promise.promiseHealth?.overall ?? 0}%`
          : '—',
        done: conditions.length > 0 && verified === conditions.length,
      },
      {
        key: 'ready',
        title: 'Payment ready',
        detail: promise?.status === 'READY_TO_FULFILL' ? 'Awaiting your authorisation' : 'Not ready yet',
        done: ['READY_TO_FULFILL', 'SETTLING', 'FULFILLED'].includes(promise?.status),
      },
      {
        key: 'fulfilled',
        title: 'Fulfillment',
        detail:
          promise?.status === 'FULFILLED'
            ? `${formatMoney(promise.amount, promise.currency)} paid to ${promise.recipient?.name}`
            : promise?.status === 'SETTLING'
              ? 'Released — waiting for the money to reach the recipient'
              : 'A person authorises this — never the engine',
        done: promise?.status === 'FULFILLED',
        action: permissions.canFulfil
          ? {
              label: 'Authorise fulfillment',
              icon: Send,
              run: () => promiseApi.fulfil(promise._id, 'Authorised in Judge Mode'),
              success: 'The money has moved.',
            }
          : null,
      },
    ];
  }, [promise, conditions, evidence, payment, permissions]);

  const buildScenario = async () => {
    setBusy('scenario');
    try {
      const result = await promiseApi.seedScenario();
      toast.success('Scenario built', `${result.promise.publicId} was created through the ordinary API.`);
      await list.reload();
      setSelectedId(result.promise._id);
    } catch (error) {
      toast.error('That scenario could not be built', error.message);
    } finally {
      setBusy(null);
    }
  };

  const runAction = async (stage) => {
    if (stage.action.open) {
      stage.action.open();
      return;
    }
    setBusy(stage.key);
    try {
      await stage.action.run();
      toast.success(stage.title, stage.action.success);
      detail.refresh();
      list.refresh();
    } catch (error) {
      if (error instanceof CheckoutDismissed) toast.info('Payment cancelled', error.message);
      else toast.error('That step did not go through', error.message);
    } finally {
      setBusy(null);
    }
  };

  if (list.loading) return <Loading label="Preparing Judge Mode…" className="min-h-[60vh]" />;
  if (list.error) return <ErrorState error={list.error} onRetry={list.reload} className="min-h-[60vh]" />;

  const completed = stages.filter((stage) => stage.done).length;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
      <header className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <p className="eyebrow flex items-center gap-2">
            <Sparkles size={11} strokeWidth={1.75} /> Judge Mode
          </p>
          <h1 className="mt-2 font-display text-[28px] leading-tight text-paper-50">
            Intent → Conditions → Proof → Validation → Fulfillment
          </h1>
          <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-paper-300">
            Every step below reads live state from the database, and every button calls the same API a normal user
            does. Nothing here is staged: a tick appears only once the record earns it.
          </p>
        </div>
        <Button variant="ghost" icon={Play} loading={busy === 'scenario'} onClick={buildScenario}>
          Build a fresh scenario
        </Button>
      </header>

      {promises.length ? (
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <span className="eyebrow">Walk through</span>
          <select
            value={focusId ?? ''}
            onChange={(event) => setSelectedId(event.target.value)}
            className="field w-auto min-w-[16rem] cursor-pointer py-2 text-[13px]"
          >
            {promises.map((entry) => (
              <option key={entry._id} value={entry._id}>
                {entry.title} — {formatMoney(entry.amount, entry.currency)} ({entry.status})
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div className="mt-8 border border-dashed border-ink-300 px-6 py-12 text-center">
          <p className="font-display text-[20px] text-paper-50">Nothing to walk through yet</p>
          <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-paper-300">
            Build the demonstration scenario — it creates a real promise, real conditions, a real funding record and
            real proof, all through the ordinary API — or write your own promise from scratch.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button variant="primary" icon={Play} loading={busy === 'scenario'} onClick={buildScenario}>
              Build the scenario
            </Button>
            <Link to="/create" className="btn-ghost">
              Write one myself
            </Link>
          </div>
        </div>
      )}

      {promise ? (
        <div className="mt-7 grid gap-6 lg:grid-cols-[1fr_17rem]">
          <div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border border-ink-300/60 bg-ink-700/40 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-[15px] text-paper-50">{promise.title}</p>
                <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-paper-400">
                  {promise.publicId} · {formatMoney(promise.amount, promise.currency)} · to {promise.recipient?.name}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusPill status={promise.status} />
                <Link to={`/promises/${promise._id}`} className="btn-quiet">
                  Open <ArrowRight size={12} strokeWidth={1.75} />
                </Link>
              </div>
            </div>

            <ol className="relative">
              <span className="absolute bottom-4 left-[0.9rem] top-4 w-px bg-ink-300/70" aria-hidden />
              {stages.map((stage, index) => (
                <motion.li
                  key={stage.key}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.04 }}
                  className="relative flex gap-4 py-3"
                >
                  <span
                    className={`relative z-10 mt-0.5 flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border ${
                      stage.done
                        ? 'border-sage-400/60 bg-sage-400/15 text-sage-300'
                        : 'border-ink-300 bg-ink-700 text-paper-400'
                    }`}
                  >
                    {stage.done ? (
                      <Check size={13} strokeWidth={2} />
                    ) : (
                      <span className="tnum font-mono text-[10px]">{String(index + 1).padStart(2, '0')}</span>
                    )}
                  </span>
                  <div className="min-w-0 flex-1 pt-1">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className={`text-[14px] ${stage.done ? 'text-paper-50' : 'text-paper-200'}`}>{stage.title}</p>
                      {stage.action ? (
                        <Button
                          variant={stage.done ? 'quiet' : 'primary'}
                          size="sm"
                          icon={stage.action.icon}
                          loading={busy === stage.key}
                          onClick={() => runAction(stage)}
                        >
                          {stage.action.label}
                        </Button>
                      ) : null}
                    </div>
                    <p className="mt-1 text-[12.5px] leading-relaxed text-paper-400">{stage.detail}</p>
                  </div>
                </motion.li>
              ))}
            </ol>
          </div>

          <aside className="space-y-5">
            <div className="panel engraved px-4 py-5">
              <ConfidenceDial value={promise.proofConfidence} size={150} />
              <p className="mt-3 text-center text-[11px] leading-relaxed text-paper-400">
                {completed} of {stages.length} stages reached, computed from the record — not from this page.
              </p>
            </div>

            <div className="panel engraved p-4">
              <p className="eyebrow flex items-center gap-2">
                <Cpu size={11} strokeWidth={1.75} /> Try this
              </p>
              <ul className="mt-3 space-y-2.5 text-[12.5px] leading-relaxed text-paper-300">
                <li>Submit proof for an open condition and watch Proof Confidence move.</li>
                <li>
                  Write “pay him when the work is good” in{' '}
                  <Link to="/create" className="text-brass-200 hover:text-brass-100">
                    a new promise
                  </Link>{' '}
                  and see the engine refuse to accept it.
                </li>
                <li>Contest a promise and ask the engine to read the record.</li>
                <li>
                  Refresh the page — every number comes back from MongoDB, because nothing lives in the browser.
                </li>
              </ul>
            </div>
          </aside>
        </div>
      ) : null}

      {promise ? (
        <SubmitProof
          open={proofOpen}
          onClose={() => setProofOpen(false)}
          promise={promise}
          conditions={conditions}
          onSubmitted={() => {
            detail.refresh();
            list.refresh();
          }}
        />
      ) : null}
    </div>
  );
}
