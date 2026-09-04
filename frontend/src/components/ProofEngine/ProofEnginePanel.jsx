import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Cpu, RefreshCw, ArrowRight } from 'lucide-react';
import { Button } from '../UI/Button.jsx';
import { EngineBadge } from '../UI/EngineBadge.jsx';
import { Skeleton } from '../UI/States.jsx';
import { promiseApi } from '../../services/promiseApi.js';

/** The Proof Engine, speaking about this promise. */
export function ProofEnginePanel({ promiseId, promise, onAct }) {
  const [briefing, setBriefing] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const read = async () => {
    setLoading(true);
    setError(null);
    try {
      setBriefing(await promiseApi.briefing(promiseId));
    } catch (caught) {
      setError(caught.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="panel engraved">
      <header className="flex items-center justify-between gap-3 border-b border-ink-300/60 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="relative flex h-6 w-6 items-center justify-center">
            <span className="absolute inset-0 rounded-full border border-brass-300/30" />
            {loading ? <span className="absolute inset-0 animate-pulse-ring rounded-full border border-brass-300/50" /> : null}
            <Cpu size={12} className="text-brass-300" strokeWidth={1.75} />
          </span>
          <div>
            <p className="label">Proof Engine</p>
            <p className="text-[13px] text-paper-100">Reading of this promise</p>
          </div>
        </div>
        <Button variant="quiet" size="sm" icon={RefreshCw} loading={loading} onClick={read}>
          {briefing ? 'Read again' : 'Read'}
        </Button>
      </header>

      <div className="px-5 py-4">
        <AnimatePresence mode="wait">
          {loading ? (
            <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <p className="mb-3 label text-paper-400">
                Reading conditions, proof and timeline…
              </p>
              <Skeleton lines={3} />
            </motion.div>
          ) : error ? (
            <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <p className="text-[13px] leading-relaxed text-rust-300">{error}</p>
              <Button variant="ghost" size="sm" className="mt-3" onClick={read}>
                Try again
              </Button>
            </motion.div>
          ) : briefing ? (
            <motion.div
              key="briefing"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="space-y-3"
            >
              <h3 className="font-display text-[19px] leading-tight text-paper-50">{briefing.headline}</h3>
              <p className="text-[13px] leading-relaxed text-paper-200">{briefing.explanation}</p>
              {briefing.nextAction ? (
                <button
                  type="button"
                  onClick={onAct}
                  className="group flex w-full items-center justify-between gap-3 border border-ink-300 bg-ink-800/60 px-3.5 py-3 text-left transition-colors hover:border-brass-300/50"
                >
                  <span>
                    <span className="block label">Next</span>
                    <span className="mt-1 block text-[13px] text-paper-100">{briefing.nextAction}</span>
                  </span>
                  <ArrowRight
                    size={14}
                    strokeWidth={1.75}
                    className="shrink-0 text-paper-400 transition-transform group-hover:translate-x-0.5 group-hover:text-brass-200"
                  />
                </button>
              ) : null}
              <EngineBadge engine={briefing.engine} model={briefing.model} />
            </motion.div>
          ) : (
            <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <p className="text-[13px] leading-relaxed text-paper-300">
                {promise?.status === 'READY_TO_FULFILL'
                  ? 'Every condition on this promise is proven. Ask the engine to summarise the record before you authorise fulfillment.'
                  : 'Ask the Proof Engine where this promise stands and what would move it forward.'}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
