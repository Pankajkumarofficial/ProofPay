import { promiseApi } from './promiseApi.js';
import { openRazorpayCheckout, CheckoutDismissed } from './razorpayCheckout.js';

/**
 * Payments are always expressed against a promise, never as a standalone amount
 * a client could choose — which is why this module delegates rather than
 * exposing its own money endpoints.
 */
export const paymentApi = {
  fund: (promiseId, providerPayload) => promiseApi.fund(promiseId, providerPayload),
  fulfil: (promiseId, note) => promiseApi.fulfil(promiseId, note),

  /**
   * Funds a promise whichever provider is configured, so no screen has to know
   * which one is active. Demo settles in the first call. Razorpay comes back
   * with `requiresPayment`, the payer authorises in the provider's own modal,
   * and the signature goes to the server to be checked before anything is held.
   */
  async fundWithCheckout({ promise, user }) {
    const opened = await promiseApi.fund(promise._id);
    if (!opened.requiresPayment) return opened;

    const signed = await openRazorpayCheckout({ checkout: opened.checkout, promise, user });
    return promiseApi.verifyFunding(promise._id, signed);
  },
};

export { CheckoutDismissed };
