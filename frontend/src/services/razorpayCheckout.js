/**
 * Razorpay Checkout, loaded only if a promise is actually funded through it.
 *
 * The script is not in index.html on purpose: a build running in demo mode
 * should not reach out to a payment provider at all. Nothing here ever sees the
 * key secret — the browser gets the publishable key id and the order id, and the
 * signature it returns is checked on the server before a rupee is held.
 */

const SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';
let loader = null;

function loadCheckout() {
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  if (loader) return loader;

  loader = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${SCRIPT_SRC}"]`);
    const script = existing ?? document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () =>
      window.Razorpay
        ? resolve(window.Razorpay)
        : reject(new Error('Razorpay Checkout loaded but did not initialise.'));
    script.onerror = () => {
      loader = null;
      reject(new Error('Could not reach Razorpay Checkout. Check your connection and try again — nothing has been charged.'));
    };
    if (!existing) document.body.appendChild(script);
  });

  return loader;
}

/** Raised when the payer closes the modal. Callers treat this as "nothing happened". */
export class CheckoutDismissed extends Error {
  constructor() {
    super('Payment cancelled. Nothing has been charged, and the promise is unchanged.');
    this.name = 'CheckoutDismissed';
    this.dismissed = true;
  }
}

/**
 * Opens the provider's modal and resolves with what it signed. The promise
 * settles exactly once: either the payer authorises (resolve), closes the modal
 * (CheckoutDismissed), or the provider reports a failure (reject).
 */
export function openRazorpayCheckout({ checkout, promise, user }) {
  return loadCheckout().then(
    (Razorpay) =>
      new Promise((resolve, reject) => {
        let settled = false;
        const settle = (fn, value) => {
          if (settled) return;
          settled = true;
          fn(value);
        };

        const instance = new Razorpay({
          key: checkout.keyId,
          order_id: checkout.orderId,
          amount: Math.round(checkout.amount * 100),
          currency: checkout.currency,
          name: 'ProofPay',
          description: promise.title,
          notes: { promiseId: promise.publicId },
          prefill: { name: user?.name ?? '', email: user?.email ?? '' },
          theme: { color: '#c9a227' },
          handler: (response) => settle(resolve, response),
          modal: { ondismiss: () => settle(reject, new CheckoutDismissed()) },
        });

        instance.on('payment.failed', (event) =>
          settle(
            reject,
            new Error(
              event?.error?.description ?? 'That payment did not go through. Nothing has been charged.'
            )
          )
        );

        instance.open();
      })
  );
}
