import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Upload, Paperclip, X } from 'lucide-react';
import { Modal } from '../UI/Modal.jsx';
import { Button } from '../UI/Button.jsx';
import { Input, Select, Textarea } from '../UI/Field.jsx';
import { EVIDENCE_TYPES } from '../../utils/status.js';
import { evidenceApi } from '../../services/evidenceApi.js';
import { useToast } from '../../context/ToastContext.jsx';

/** What each kind of proof actually is. */
const FILE_KINDS = new Set([
  'image',
  'screenshot',
  'pdf',
  'document',
  'invoice',
  'test_report',
  'delivery_confirmation',
]);

const IMAGES = 'image/png,image/jpeg,image/webp,image/gif';
const DOCS = 'application/pdf,text/plain,text/csv,application/json,.doc,.docx,.xls,.xlsx';

/** Narrowed to what the chosen kind means, within what the API will accept. */
const ACCEPT = {
  image: IMAGES,
  screenshot: IMAGES,
  pdf: 'application/pdf',
  invoice: `application/pdf,${IMAGES}`,
  delivery_confirmation: `application/pdf,${IMAGES}`,
  document: DOCS,
  test_report: DOCS,
};
const ACCEPT_ANY = `${IMAGES},${DOCS}`;

const FILE_CTA = {
  image: 'Choose an image',
  screenshot: 'Choose a screenshot',
  pdf: 'Choose a PDF',
  document: 'Choose a document',
  invoice: 'Choose the invoice',
  test_report: 'Choose the report',
  delivery_confirmation: 'Choose the confirmation',
};

const schema = z
  .object({
    conditionId: z.string().min(1, 'Choose the condition this proves.'),
    type: z.string().min(1),
    title: z.string().trim().max(160).optional(),
    url: z.string().trim().max(500).optional(),
    note: z.string().trim().max(2000).optional(),
    autoVerify: z.boolean().default(true),
  })
  .superRefine((values, ctx) => {
    if (values.type === 'url' && !values.url) {
      ctx.addIssue({ path: ['url'], code: z.ZodIssueCode.custom, message: 'A link is required for link proof.' });
    }
    if (values.url && !/^https?:\/\/\S+$/i.test(values.url)) {
      ctx.addIssue({ path: ['url'], code: z.ZodIssueCode.custom, message: 'Use a full URL starting with http.' });
    }
  });

/** Files proof against a specific condition. */
export function SubmitProof({ open, onClose, promise, conditions = [], defaultConditionId, onSubmitted }) {
  const toast = useToast();
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const defaults = useMemo(
    () => ({
      conditionId: defaultConditionId ?? conditions[0]?._id ?? '',
      type: 'url',
      title: '',
      url: '',
      note: '',
      autoVerify: true,
    }),
    [defaultConditionId, conditions]
  );

  const {
    register,
    handleSubmit,
    watch,
    reset,
    setError,
    formState: { errors },
  } = useForm({ resolver: zodResolver(schema), defaultValues: defaults, values: defaults });

  const type = watch('type');
  const wantsFile = FILE_KINDS.has(type);
  const selectedCondition = conditions.find((condition) => condition._id === watch('conditionId'));

  /** Changing the kind re-frames the form, so a stale complaint about it is wrong. */
  useEffect(() => setFileError(null), [type]);

  const close = () => {
    setFile(null);
    setFileError(null);
    reset(defaults);
    onClose();
  };

  const onSubmit = async (values) => {
    // A file kind wants the artefact itself.
    if (wantsFile && !file && !values.url) {
      setFileError(`Attach the ${(FILE_CTA[type] ?? 'Choose a file').replace(/^Choose (an?|the) /, '')}, or paste a link to it.`);
      return;
    }
    if (!file && !values.url && !values.note) {
      setError('note', { message: 'Attach a file, add a link, or write what happened.' });
      return;
    }
    setSubmitting(true);
    try {
      const result = await evidenceApi.submit({
        promiseId: promise._id,
        conditionId: values.conditionId,
        type: values.type,
        title: values.title,
        url: values.url || undefined,
        note: values.note,
        autoVerify: values.autoVerify,
        file,
      });

      if (result.assessing) {
        // The reading happens in the background now.
        toast.info(
          'Proof filed — the Proof Engine is reading it',
          'It appears against the condition as soon as there is a verdict.'
        );
      } else {
        toast.success('Proof filed', 'It is in the vault, waiting to be read against a condition.');
      }

      onSubmitted?.(result);
      close();
    } catch (error) {
      toast.error('That proof could not be filed', error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const linkField = (
    <Input
      key="link"
      label={wantsFile ? 'Or link to it' : 'Link'}
      placeholder="https://"
      required={type === 'url'}
      hint={wantsFile ? 'If it already lives online' : type === 'url' ? 'Required' : 'Optional'}
      error={errors.url?.message}
      {...register('url')}
    />
  );

  const attachmentField = (
    <div key="attachment">
      <span className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="label">
          Attachment
          {wantsFile ? <span className="ml-1 text-brass-300">*</span> : null}
        </span>
        {!fileError ? (
          <span className="text-[10px] text-paper-400">
            {wantsFile ? 'The artefact itself' : 'Optional'}
          </span>
        ) : null}
      </span>
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        onChange={(event) => {
          setFile(event.target.files?.[0] ?? null);
          setFileError(null);
        }}
        accept={ACCEPT[type] ?? ACCEPT_ANY}
      />
      {file ? (
        <div className="flex items-center justify-between gap-3 border border-ink-300 bg-ink-800/60 px-3 py-2.5">
          <span className="flex min-w-0 items-center gap-2">
            <Paperclip size={13} className="shrink-0 text-paper-400" strokeWidth={1.75} />
            <span className="truncate text-[13px] text-paper-100">{file.name}</span>
            <span className="tnum shrink-0 font-mono text-[10px] text-paper-400">
              {(file.size / 1024).toFixed(0)}KB
            </span>
          </span>
          <button
            type="button"
            onClick={() => {
              setFile(null);
              if (fileRef.current) fileRef.current.value = '';
            }}
            className="text-paper-400 hover:text-paper-50"
            aria-label="Remove attachment"
          >
            <X size={14} strokeWidth={1.75} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className={`flex w-full items-center justify-center gap-2 border border-dashed bg-ink-800/40 px-3 label transition-colors hover:border-brass-300/50 hover:text-paper-200 ${
            fileError ? 'border-rust-400/70 text-rust-300' : 'border-ink-300 text-paper-400'
          } ${wantsFile ? 'py-7' : 'py-5'}`}
        >
          <Upload size={13} strokeWidth={1.75} />
          {FILE_CTA[type] ?? 'Choose a file'}
        </button>
      )}
      {fileError ? <span className="mt-1.5 block text-[11px] text-rust-300">{fileError}</span> : null}
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={close}
      label="Evidence Vault"
      title="Submit proof"
      width="max-w-xl"
      footer={
        <>
          <Button variant="quiet" onClick={close} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" icon={Upload} loading={submitting} onClick={handleSubmit(onSubmit)}>
            File proof
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <Select label="Proves which condition" required error={errors.conditionId?.message} {...register('conditionId')}>
          {conditions.map((condition, index) => (
            <option key={condition._id} value={condition._id}>
              {String(index + 1).padStart(2, '0')} — {condition.description.slice(0, 70)}
            </option>
          ))}
        </Select>

        {selectedCondition?.requiredEvidence?.length ? (
          <div className="border border-ink-300/70 bg-ink-800/60 px-3 py-2.5">
            <p className="label">Normally settled by</p>
            <ul className="mt-1.5 space-y-1">
              {selectedCondition.requiredEvidence.map((requirement) => (
                <li key={requirement} className="flex gap-2 text-[12px] text-paper-200">
                  <span className="text-brass-300">·</span>
                  {requirement}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Kind of proof" options={EVIDENCE_TYPES} {...register('type')} />
          <Input label="Title" placeholder="What is this?" error={errors.title?.message} {...register('title')} />
        </div>

        {/* The kind decides what leads. */}
        {type === 'note' ? null : (
          <div className="space-y-4">
            {wantsFile ? attachmentField : linkField}
            {wantsFile ? linkField : attachmentField}
          </div>
        )}

        <Textarea
          label="What does this show?"
          rows={3}
          placeholder="Describe what happened, in enough detail that someone can check it."
          error={errors.note?.message}
          {...register('note')}
        />

        <label className="flex cursor-pointer items-start gap-2.5 border border-ink-300/70 bg-ink-800/40 px-3 py-2.5">
          <input type="checkbox" className="mt-0.5 accent-brass-300" {...register('autoVerify')} />
          <span>
            <span className="block text-[13px] text-paper-100">Ask the Proof Engine to read it now</span>
            <span className="mt-0.5 block text-[11px] leading-relaxed text-paper-400">
              It assesses this proof against the condition and records a validation. It never releases money.
            </span>
          </span>
        </label>
      </form>
    </Modal>
  );
}
