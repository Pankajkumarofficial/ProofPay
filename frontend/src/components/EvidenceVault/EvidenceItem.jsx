import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FileText, Link2, Image as ImageIcon, Receipt, GitBranch, FlaskConical,
  PackageCheck, StickyNote, Camera, FileType2, Cpu, RefreshCw, Trash2,
  Download, Maximize2, Minimize2, FileWarning,
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
  const [missing, setMissing] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // What the file *is*, not what it was filed as: someone attaching a scan
  // under "document" still gets to see the page.
  const mime = evidence.mimeType ?? '';
  const isImage = Boolean(evidence.fileUrl) && (mime.startsWith('image/') || ['image', 'screenshot'].includes(evidence.type));
  const isPdf = Boolean(evidence.fileUrl) && (mime === 'application/pdf' || evidence.type === 'pdf');

  /**
   * Proof filed before uploads were kept in the database points at `/uploads`,
   * a directory the host empties on every redeploy. An <img> reports that
   * itself through onError; an <iframe> does not — it renders the API's JSON
   * 404 inside the frame, which looks like the product is broken rather than
   * like the file is gone. So these paths, and only these, are checked first.
   * Anything under /api/files is in Mongo and needs no request to prove it.
   */
  const isLegacyPath = Boolean(evidence.fileUrl?.startsWith('/uploads/'));
  useEffect(() => {
    if (!isLegacyPath) return undefined;
    const controller = new AbortController();
    fetch(evidence.fileUrl, { method: 'HEAD', signal: controller.signal })
      .then((response) => {
        if (!response.ok) setMissing(true);
      })
      .catch(() => {
        // An aborted request is the component unmounting, not a missing file.
        if (!controller.signal.aborted) setMissing(true);
      });
    return () => controller.abort();
  }, [isLegacyPath, evidence.fileUrl]);

  return (
    <article className="panel-quiet group p-4 transition-colors hover:border-ink-300">
      <div className="flex items-start gap-3.5">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center border border-ink-300 bg-ink-600 text-paper-300">
          <Icon size={15} strokeWidth={1.5} />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
            <h3 className="min-w-0 flex-1 truncate text-[14px] text-paper-50">{evidence.title || 'Untitled proof'}</h3>
            <span className={`shrink-0 label ${meta.text}`}>
              {meta.label}
              {evidence.confidence ? <span className="tnum ml-1.5 text-paper-400">{evidence.confidence}%</span> : null}
            </span>
          </div>

          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 label text-paper-400">
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
                <span className="label">
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
            <div className="mt-3">
              {/*
                Proof you can see without leaving the vault. An assessor reading
                a verdict should be able to check it against the artefact in the
                same glance — following a link to a new tab and coming back is
                how a reviewer stops checking.
              */}
              {missing ? (
                <p className="flex items-start gap-2 border border-ochre-300/30 bg-ochre-300/5 px-3 py-2.5 text-[12px] leading-snug text-ochre-200">
                  <FileWarning size={13} strokeWidth={1.75} className="mt-px shrink-0" />
                  <span>
                    This file is no longer stored. It was filed before uploads were kept in the
                    database, on a filesystem the host has since wiped — the reading below is what
                    the Proof Engine made of it at the time.
                  </span>
                </p>
              ) : isImage ? (
                <a href={evidence.fileUrl} target="_blank" rel="noreferrer noopener" className="block">
                  <img
                    src={evidence.fileUrl}
                    alt={evidence.title || 'Submitted proof'}
                    loading="lazy"
                    onError={() => setMissing(true)}
                    className="max-h-72 w-full border border-ink-300 bg-ink-800 object-contain"
                  />
                </a>
              ) : isPdf ? (
                <div className="border border-ink-300 bg-ink-800">
                  <iframe
                    // Same origin, so `frame-src 'self'` covers it. An <embed>
                    // would not: helmet's `object-src 'none'` blocks those, and
                    // it blocks them only once CSP is on — in production alone.
                    src={`${evidence.fileUrl}#toolbar=0&view=FitH`}
                    title={evidence.fileName || 'Submitted proof'}
                    loading="lazy"
                    className={`w-full transition-[height] ${expanded ? 'h-[36rem]' : 'h-64'}`}
                  />
                  <div className="flex items-center justify-between gap-3 border-t border-ink-300 px-2.5 py-1.5">
                    <span className="truncate font-mono text-[11px] text-paper-400">{evidence.fileName}</span>
                    <span className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="quiet"
                        size="sm"
                        icon={expanded ? Minimize2 : Maximize2}
                        onClick={() => setExpanded((open) => !open)}
                      >
                        {expanded ? 'Collapse' : 'Expand'}
                      </Button>
                      <a
                        href={evidence.fileUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1.5 px-2 py-1 label text-brass-200 hover:text-brass-100"
                      >
                        <Download size={11} strokeWidth={1.75} /> Open
                      </a>
                    </span>
                  </div>
                </div>
              ) : (
                <a
                  href={evidence.fileUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="flex items-center gap-2.5 border border-ink-300 bg-ink-800 px-3 py-2.5 transition-colors hover:border-brass-300/40"
                >
                  <FileText size={15} strokeWidth={1.5} className="shrink-0 text-paper-300" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[11px] text-brass-200">
                      {evidence.fileName ?? 'Open file'}
                    </span>
                    <span className="block label text-paper-400">
                      {/* A .docx cannot be shown in a browser; saying so beats an empty frame. */}
                      Not previewable in the browser — opens in a new tab
                    </span>
                  </span>
                  <Download size={13} strokeWidth={1.75} className="shrink-0 text-paper-400" />
                </a>
              )}
            </div>
          ) : null}

          {evidence.aiExplanation ? (
            <div className="mt-3 border-l-2 border-ink-300 bg-ink-800/60 px-3 py-2.5">
              <p className="flex items-center gap-1.5 label text-paper-400">
                <Cpu size={10} strokeWidth={1.75} /> Proof Engine
              </p>
              <p className="wrap-pasted mt-1.5 text-[12px] leading-relaxed text-paper-200">{evidence.aiExplanation}</p>
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
