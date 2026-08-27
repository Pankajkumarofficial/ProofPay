import { useMemo, useState } from 'react';
import { Archive, Search } from 'lucide-react';
import { EvidenceItem } from '../components/EvidenceVault/EvidenceItem.jsx';
import { Loading, ErrorState, EmptyState } from '../components/UI/States.jsx';
import { Select } from '../components/UI/Field.jsx';
import { useApi } from '../hooks/useApi.js';
import { useDebounced } from '../hooks/useDebounced.js';
import { useLiveUpdates } from '../hooks/useLiveUpdates.js';
import { evidenceApi } from '../services/evidenceApi.js';
import { useToast } from '../context/ToastContext.jsx';
import { EVIDENCE_TYPES } from '../utils/status.js';

const STATUS_OPTIONS = [
  { value: '', label: 'Any assessment' },
  { value: 'SUBMITTED', label: 'Submitted' },
  { value: 'ACCEPTED', label: 'Supports' },
  { value: 'INSUFFICIENT', label: 'Insufficient' },
  { value: 'CONTRADICTED', label: 'Contradicts' },
];

export function EvidenceVault() {
  const toast = useToast();
  const [term, setTerm] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [promiseId, setPromiseId] = useState('');
  const [busy, setBusy] = useState(null);

  const search = useDebounced(term, 280);

  const vault = useApi(
    () =>
      evidenceApi.list({
        ...(search.trim() ? { search: search.trim() } : {}),
        ...(type ? { type } : {}),
        ...(status ? { status } : {}),
        ...(promiseId ? { promiseId } : {}),
        limit: 80,
      }),
    [search, type, status, promiseId]
  );

  useLiveUpdates(() => vault.refresh());

  const evidence = vault.data?.evidence ?? [];
  const promises = vault.data?.promises ?? [];
  const typeCounts = vault.data?.typeCounts ?? [];

  const typeOptions = useMemo(
    () => [
      { value: '', label: `All kinds${typeCounts.length ? ` (${typeCounts.reduce((sum, row) => sum + row.count, 0)})` : ''}` },
      ...EVIDENCE_TYPES.map((entry) => {
        const found = typeCounts.find((row) => row.type === entry.value);
        return { value: entry.value, label: found ? `${entry.label} (${found.count})` : entry.label };
      }),
    ],
    [typeCounts]
  );

  const verify = async (item) => {
    setBusy(item._id);
    try {
      const result = await evidenceApi.verify(item._id);
      toast.push({
        tone: result.assessment.verdict === 'SUPPORTS' ? 'success' : result.assessment.verdict === 'CONTRADICTS' ? 'error' : 'warning',
        title: `Proof Engine: ${result.assessment.verdict.toLowerCase()} at ${result.assessment.confidence}%`,
        body: result.assessment.explanation,
        duration: 9000,
      });
      vault.refresh();
    } catch (error) {
      toast.error('That could not be re-read', error.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Evidence Vault</p>
          <h1 className="mt-1.5 font-display text-[28px] leading-tight text-paper-50">
            {vault.loading ? 'Proof on record' : `${evidence.length} ${evidence.length === 1 ? 'item' : 'items'} of proof`}
          </h1>
          <p className="mt-1.5 text-[13px] text-paper-300">
            Everything filed against your promises, with what the Proof Engine made of it.
          </p>
        </div>
      </header>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-paper-400" strokeWidth={1.75} />
          <input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Search titles, notes, files, links"
            className="field pl-9"
          />
        </div>
        <Select value={type} onChange={(event) => setType(event.target.value)} options={typeOptions} />
        <Select value={status} onChange={(event) => setStatus(event.target.value)} options={STATUS_OPTIONS} />
        <Select
          value={promiseId}
          onChange={(event) => setPromiseId(event.target.value)}
          options={[
            { value: '', label: 'All promises' },
            ...promises.map((promise) => ({ value: promise._id, label: promise.title })),
          ]}
        />
      </div>

      <div className="mt-6">
        {vault.loading ? (
          <Loading label="Loading the vault…" />
        ) : vault.error ? (
          <ErrorState error={vault.error} onRetry={vault.reload} />
        ) : evidence.length ? (
          <div className="space-y-3">
            {evidence.map((item) => (
              <EvidenceItem
                key={item._id}
                evidence={item}
                showPromise
                verifying={busy === item._id}
                onVerify={verify}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Archive}
            title={term || type || status || promiseId ? 'Nothing matches those filters' : 'The vault is empty'}
            body={
              term || type || status || promiseId
                ? 'Clear a filter to see the rest of your proof.'
                : 'Proof arrives here the moment it is filed against a condition — a link, a file, a report, or a written account.'
            }
          />
        )}
      </div>
    </div>
  );
}
