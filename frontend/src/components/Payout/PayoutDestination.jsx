import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Landmark, Smartphone, ShieldCheck } from 'lucide-react';
import { Modal } from '../UI/Modal.jsx';
import { Button } from '../UI/Button.jsx';
import { Input } from '../UI/Field.jsx';
import { promiseApi } from '../../services/promiseApi.js';
import { useToast } from '../../context/ToastContext.jsx';

const bankSchema = z.object({
  accountHolder: z.string().trim().min(2, 'Whose account is this?').max(80),
  accountNumber: z.string().trim().regex(/^\d{6,20}$/, 'An account number is 6 to 20 digits.'),
  ifsc: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'That IFSC does not look right (e.g. HDFC0001234).'),
});

const upiSchema = z.object({
  vpa: z
    .string()
    .trim()
    .regex(/^[a-z0-9.\-_]{2,60}@[a-z]{2,30}$/i, 'That does not look like a UPI ID (name@bank).'),
});

/**
 * Where the recipient gets paid.
 *
 * What is typed here is sent once to the payment provider and never stored by
 * ProofPay — the server keeps only the provider's opaque ids and a masked
 * label. That is worth saying on the form itself, because people are right to
 * hesitate before typing an account number into someone's app.
 */
export function PayoutDestination({ open, onClose, promise, onSaved }) {
  const toast = useToast();
  const [method, setMethod] = useState('upi');
  const [saving, setSaving] = useState(false);

  const isUpi = method === 'upi';
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({ resolver: zodResolver(isUpi ? upiSchema : bankSchema) });

  const close = () => {
    reset();
    onClose();
  };

  const switchMethod = (next) => {
    setMethod(next);
    reset();
  };

  const onSubmit = async (values) => {
    setSaving(true);
    try {
      const result = await promiseApi.setPayoutDestination(promise._id, { method, ...values });
      toast.success('Payout destination saved', `Money will go to ${result.destination.label}.`);
      onSaved?.(result);
      close();
    } catch (error) {
      toast.error('That destination could not be saved', error.message);
    } finally {
      setSaving(false);
    }
  };

  const tab = (value, label, Icon) => (
    <button
      key={value}
      type="button"
      onClick={() => switchMethod(value)}
      className={`flex flex-1 items-center justify-center gap-2 border px-3 py-2.5 font-mono text-[11px] uppercase tracking-wider transition-colors ${
        method === value
          ? 'border-brass-300/60 bg-brass-300/10 text-brass-200'
          : 'border-ink-300 text-paper-400 hover:text-paper-200'
      }`}
    >
      <Icon size={13} strokeWidth={1.75} />
      {label}
    </button>
  );

  return (
    <Modal
      open={open}
      onClose={close}
      eyebrow="Payout"
      title="Where should this money go?"
      width="max-w-lg"
      footer={
        <>
          <Button variant="quiet" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} onClick={handleSubmit(onSubmit)}>
            Save destination
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <p className="text-[13px] leading-relaxed text-paper-300">
          Paying <span className="text-paper-100">{promise.recipient.name}</span>. Nothing moves until
          every condition is proven and{' '}
          {/* Either side may say where the money goes; only the payer releases it. */}
          {promise.relation === 'payer' ? 'you authorise' : 'the payer authorises'} it.
        </p>

        <div className="flex gap-2">
          {tab('upi', 'UPI', Smartphone)}
          {tab('bank', 'Bank account', Landmark)}
        </div>

        {isUpi ? (
          <Input
            label="UPI ID"
            placeholder="name@bank"
            required
            error={errors.vpa?.message}
            {...register('vpa')}
          />
        ) : (
          <>
            <Input
              label="Account holder"
              placeholder="As printed on the account"
              required
              error={errors.accountHolder?.message}
              {...register('accountHolder')}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Account number"
                placeholder="000000000000"
                required
                inputMode="numeric"
                autoComplete="off"
                error={errors.accountNumber?.message}
                {...register('accountNumber')}
              />
              <Input
                label="IFSC"
                placeholder="HDFC0001234"
                required
                autoCapitalize="characters"
                autoComplete="off"
                error={errors.ifsc?.message}
                {...register('ifsc')}
              />
            </div>
          </>
        )}

        <p className="flex gap-2.5 border border-ink-300/70 bg-ink-800/40 px-3 py-2.5 text-[11px] leading-relaxed text-paper-400">
          <ShieldCheck size={13} className="mt-0.5 shrink-0 text-sage-300" strokeWidth={1.75} />
          <span>
            This goes straight to the payment provider, which returns a reference ProofPay stores in
            its place.{' '}
            {isUpi
              ? 'A UPI ID is a handle rather than an account number, so it is kept as typed and shown back to you.'
              : 'Only the last four digits of the account number are kept — never the whole number.'}
          </span>
        </p>
      </form>
    </Modal>
  );
}
