import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Smartphone, Copy, Check, ShieldAlert } from 'lucide-react';
import { Button } from '../UI/Button.jsx';
import { Input } from '../UI/Field.jsx';
import { promiseApi } from '../../services/promiseApi.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatMoney } from '../../utils/format.js';
import { describePayout } from '../../utils/status.js';

/**
 * Settling a released promise over UPI.
 *
 * ProofPay holds no money — custodial escrow needs a payment aggregator
 * licence. What it does instead is prove the promise, gate the release behind a
 * person, and hand that person a pre-filled payment their own bank app
 * executes. The money is real; the custody was never ours.
 *
 * The reference typed back is checked for structure before anything is marked
 * paid, and recorded as payer-reported — not as a bank confirmation, which this
 * app has no way to obtain and therefore never claims.
 */
export function SettleOverUpi({ promise, payout, onSettled }) {
  const toast = useToast();
  const [qr, setQr] = useState(null);
  const [utr, setUtr] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!payout?.link) return;
    // Dark-on-light: a scanner needs the contrast, whatever the page theme is.
    QRCode.toDataURL(payout.link, { margin: 1, width: 240, color: { dark: '#0d0d0f', light: '#f5f2ea' } })
      .then(setQr)
      .catch(() => setQr(null));
  }, [payout?.link]);

  const copyLink = async () => {
    await navigator.clipboard.writeText(payout.link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await promiseApi.confirmPayout(promise._id, utr.trim());
      // A reference that could not be placed against the payment is still
      // recorded — but the payer is told so, rather than finding out from a
      // caveat on a line further down the page.
      toast.success(
        'Payment recorded',
        [describePayout(result.payout, 'payer'), result.payout.verificationNote]
          .filter(Boolean)
          .join(' ')
      );
      onSettled?.(result);
    } catch (failure) {
      // Shown on the field, not as a toast: the number needs correcting here.
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="border border-ink-300/70 bg-ink-800/40 p-4 sm:p-5">
      <p className="eyebrow">Settle over UPI</p>
      <h3 className="mt-1 font-display text-[19px] text-paper-50">
        Pay {formatMoney(promise.amount, promise.currency)} to {promise.recipient.name}
      </h3>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-paper-300">
        Every condition is proven and you have authorised the release. ProofPay never held this
        money — pay from your own account, then record the reference here.
      </p>

      <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-start">
        {qr ? (
          <img
            src={qr}
            alt={`UPI payment QR for ${payout.destinationLabel}`}
            className="h-[150px] w-[150px] shrink-0 border border-ink-300"
          />
        ) : null}

        <div className="min-w-0 flex-1 space-y-3">
          <a href={payout.link} className="btn-primary w-full justify-center sm:w-auto">
            <Smartphone size={14} strokeWidth={1.75} />
            Open my UPI app
          </a>
          <p className="text-[11px] leading-relaxed text-paper-400">
            On a phone this opens GPay, PhonePe or Paytm with the amount, {payout.destinationLabel} and
            this promise’s ID already filled in. On a desktop, scan the code.
          </p>
          <button
            type="button"
            onClick={copyLink}
            className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-paper-400 hover:text-paper-200"
          >
            {copied ? <Check size={11} strokeWidth={2} /> : <Copy size={11} strokeWidth={1.75} />}
            {copied ? 'Link copied' : 'Copy payment link'}
          </button>
        </div>
      </div>

      <div className="mt-5 border-t border-ink-300/60 pt-4">
        <Input
          label="UTR from your bank app"
          placeholder="12 digits"
          hint="Shown as “UPI transaction ID”"
          inputMode="numeric"
          value={utr}
          error={error}
          onChange={(event) => {
            setUtr(event.target.value);
            setError(null);
          }}
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button variant="primary" loading={busy} disabled={!utr.trim()} onClick={confirm}>
            Record the payment
          </Button>
          <span className="flex items-start gap-1.5 text-[11px] leading-relaxed text-paper-400">
            <ShieldAlert size={12} className="mt-0.5 shrink-0 text-ochre-300" strokeWidth={1.75} />
            The reference is checked for structure and date. ProofPay cannot confirm it with your
            bank, so it is recorded as reported by you.
          </span>
        </div>
      </div>
    </section>
  );
}
