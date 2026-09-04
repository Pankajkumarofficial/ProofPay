import { useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, Check, Plus } from 'lucide-react';
import { Button } from '../UI/Button.jsx';
import { Input } from '../UI/Field.jsx';

/** When the Proof Engine cannot objectively verify a phrase, ProofPay refuses to guess what it means. */
export function AmbiguityResolver({ ambiguities = [], onResolve, resolved = {} }) {
  const [custom, setCustom] = useState({});

  if (!ambiguities.length) return null;

  return (
    <div className="border border-ochre-400/40 bg-ochre-400/[0.04]">
      <header className="flex items-start gap-3 border-b border-ochre-400/25 px-4 py-3.5">
        <AlertTriangle size={15} className="mt-0.5 shrink-0 text-ochre-300" strokeWidth={1.75} />
        <div>
          <p className="text-[14px] text-paper-50">
            {ambiguities.length === 1 ? 'This promise is ambiguous.' : `${ambiguities.length} parts of this promise are ambiguous.`}
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-paper-300">
            Money should not move on a phrase nobody can check. Choose what would actually settle each one.
          </p>
        </div>
      </header>

      <div className="divide-y divide-ochre-400/15">
        {ambiguities.map((ambiguity, index) => {
          const choice = resolved[ambiguity.phrase];
          return (
            <motion.div
              key={`${ambiguity.phrase}-${index}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.06 }}
              className="px-4 py-3.5"
            >
              <p className="label text-ochre-300">
                “{ambiguity.phrase}”
              </p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-paper-300">{ambiguity.reason}</p>

              {choice ? (
                <p className="mt-2.5 flex items-center gap-2 text-[13px] text-sage-300">
                  <Check size={13} strokeWidth={2} />
                  {choice}
                </p>
              ) : (
                <>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {ambiguity.suggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => onResolve(ambiguity, suggestion)}
                        className="border border-ink-300 bg-ink-700/60 px-2.5 py-1.5 text-[12px] text-paper-200 transition-colors hover:border-brass-300/60 hover:text-paper-50"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <Input
                      placeholder="Or write your own condition"
                      value={custom[ambiguity.phrase] ?? ''}
                      onChange={(event) =>
                        setCustom((current) => ({ ...current, [ambiguity.phrase]: event.target.value }))
                      }
                      className="flex-1"
                    />
                    <Button
                      variant="ghost"
                      icon={Plus}
                      disabled={!custom[ambiguity.phrase]?.trim()}
                      onClick={() => onResolve(ambiguity, custom[ambiguity.phrase].trim())}
                    >
                      Add
                    </Button>
                  </div>
                </>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
