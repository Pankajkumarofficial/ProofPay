import { promiseApi } from './promiseApi.js';
import { openRazorpayCheckout, CheckoutDismissed } from './razorpayCheckout.js';

/** Payments are always expressed against a promise, never as a standalone amount a client could choose. */
export const paymentApi = {
  fund: (promiseId, providerPayload) => promiseApi.fund(promiseId, providerPayload),
  fulfil: (promiseId, note) => promiseApi.fulfil(promiseId, note),

  /** Funds a promise whichever provider is configured, so no screen has to know which one is active. */
  async fundWithCheckout({ promise, user }) {
    const opened = await promiseApi.fund(promise._id);
    if (!opened.requiresPayment) return opened;

    const signed = await openRazorpayCheckout({ checkout: opened.checkout, promise, user });
    return promiseApi.verifyFunding(promise._id, signed);
  },
};

export { CheckoutDismissed };
