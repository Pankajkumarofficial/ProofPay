import { Link } from 'react-router-dom';
import {
  FileText, Link2, Image as ImageIcon, Receipt, GitBranch, FlaskConical,
  PackageCheck, StickyNote, Camera, FileType2, Cpu, RefreshCw, Trash2,
} from 'lucide-react';
import { evidenceMeta } from '../../utils/status.js';
import { formatDate, relativeTime } from '../../utils/format.js';
import { Avatar } from '../UI/Avatar.jsx';
import { Button } from '../UI/Button.jsx';

const TYPE_ICON = {
  url: Link2,
  image: ImageIcon,
  screenshot: Camera,
  pdf: FileType2,
  document: FileText,
  invoice: Receipt,
  repository: GitBranch,
  test_report: FlaskConical,
  delivery_confirmation: PackageCheck,
  note: StickyNote,
};

const readableSize = (bytes) => {
  if (!bytes) return null;
  const units = ['B', 'KB', 'MB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)}${units[unit]}`;
};

/**
 * One item of proof, exactly as stored: its type, where it came from, what the
 * Proof Engine made of it, and who filed it.
 */
export function EvidenceItem({ evidence, onVerify, onRemove, verifying = false, showPromise = false }) {
  const Icon = TYPE_ICON[evidence.type] ?? FileText;
  const meta = evidenceMeta(evidence.status);
  const isImage = ['image', 'screenshot'].includes(evidence.type) && evidence.fileUrl;

  return (
    <article className="panel-quiet group p-4 transition-colors hover:border-ink-300">
      <div className="flex items-start gap-3.5">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center border border-ink-300 bg-ink-600 text-paper-300">
          <Icon size={15} strokeWidth={1.5} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
            <h3 className="min-w-0 flex-1 truncate text-[14px] text-paper-50">{evidence.title || 'Untitled proof'}</h3>
            <span className={`shrink-0 font-mono text-[10px] uppercase tracking-wider ${meta.text}`}>
              {meta.label}
              {evidence.confidence ? <span className="tnum ml-1.5 text-paper-400">{evidence.confidence}%</span> : null}
            </span>
          </div>

          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] uppercase tracking-wider text-paper-400">
            <span>{evidence.type.replace(/_/g, ' ')}</span>
            <span aria-hidden>·</span>
            <span>{evidence.source}</span>
            {evidence.fileSize ? (
              <>
                <span aria-hidden>·</span>
                <span className="tnum">{readableSize(evidence.fileSize)}</span>
              </>
            ) : null}
            <span aria-hidden>·</span>
            <span title={formatDate(evidence.createdAt, { withTime: true })}>{relativeTime(evidence.createdAt)}</span>
          </p>

          {evidence.condition ? (
            <p className="mt-2 border-l border-ink-300 pl-2.5 text-[12px] leading-snug text-paper-300">
              {evidence.condition.label ? (
                <span className="font-mono text-[10px] uppercase tracking-wider text-paper-400">
                  {evidence.condition.label} ·{' '}
                </span>
              ) : null}
              {evidence.condition.description}
            </p>
          ) : (
            <p className="mt-2 text-[12px] text-ochre-300">
              Not filed against a condition yet — the Proof Engine has nothing to test it against.
            </p>
          )}

          {evidence.note ? (
            <p className="mt-2.5 whitespace-pre-line text-[13px] leading-relaxed text-paper-200">{evidence.note}</p>
          ) : null}

          {evidence.url ? (
            <a
              href={evidence.url}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-2 inline-flex max-w-full items-center gap-1.5 truncate font-mono text-[11px] text-brass-200 underline decoration-brass-300/30 underline-offset-4 hover:text-brass-100"
            >
              <Link2 size={11} strokeWidth={1.75} />
              {evidence.url}
            </a>
          ) : null}

          {evidence.fileUrl ? (
            isImage ? (
              <a href={evidence.fileUrl} target="_blank" rel="noreferrer noopener" className="mt-3 block">
                <img
                  src={evidence.fileUrl}
                  alt={evidence.title || 'Submitted proof'}
                  loading="lazy"
                  className="max-h-56 w-full border border-ink-300 object-cover"
                />
              </a>
            ) : (
              <a
                href={evidence.fileUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-2 inline-flex items-center gap-1.5 font-mono text-[11px] text-brass-200 underline decoration-brass-300/30 underline-offset-4 hover:text-brass-100"
              >
                <FileText size={11} strokeWidth={1.75} />
                {evidence.fileName ?? 'Open file'}
              </a>
            )
          ) : null}

          {evidence.aiExplanation ? (
            <div className="mt-3 border-l-2 border-ink-300 bg-ink-800/60 px-3 py-2.5">
              <p className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-widest text-paper-400">
                <Cpu size={10} strokeWidth={1.75} /> Proof Engine
              </p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-paper-200">{evidence.aiExplanation}</p>
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <Avatar user={evidence.submittedBy} size={20} />
              <span className="text-[11px] text-paper-400">
                {evidence.submittedBy?.name ?? 'Unknown'}
                {showPromise && evidence.promise ? (
                  <>
                    {' · '}
                    <Link to={`/promises/${evidence.promise._id}`} className="text-brass-200 hover:text-brass-100">
                      {evidence.promise.title}
                    </Link>
                  </>
                ) : null}
              </span>
            </span>

            <span className="flex items-center gap-1.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
              {onVerify && evidence.condition ? (
                <Button variant="quiet" size="sm" icon={RefreshCw} loading={verifying} onClick={() => onVerify(evidence)}>
                  Re-read
                </Button>
              ) : null}
              {onRemove ? (
                <Button variant="quiet" size="sm" icon={Trash2} onClick={() => onRemove(evidence)}>
                  Withdraw
                </Button>
              ) : null}
            </span>
          </div>
        </div>
      </div>
    </article>
  );
}
