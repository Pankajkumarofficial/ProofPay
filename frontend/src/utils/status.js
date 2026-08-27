/**
 * The vocabulary of the product, in one place.
 *
 * Statuses themselves always arrive from the API — this maps them to how they
 * look and read. Adding a status server-side without updating this map degrades
 * gracefully to a neutral treatment rather than breaking a screen.
 */

const NEUTRAL = {
  label: 'Unknown',
  tone: 'slate',
  text: 'text-slate-300',
  border: 'border-slate-400/40',
  bg: 'bg-slate-400/10',
  dot: 'bg-slate-300',
  hex: '#8B9296',
  description: 'This state is not one this build recognises.',
};

export const PROMISE_STATUS_META = {
  DRAFT: {
    label: 'Draft',
    tone: 'slate',
    text: 'text-slate-300',
    border: 'border-slate-400/40',
    bg: 'bg-slate-400/10',
    dot: 'bg-slate-300',
    hex: '#8B9296',
    description: 'Written down, but no money is held against it yet.',
  },
  FUNDED: {
    label: 'Funded',
    tone: 'brass',
    text: 'text-brass-200',
    border: 'border-brass-300/40',
    bg: 'bg-brass-300/10',
    dot: 'bg-brass-300',
    hex: '#D9A441',
    description: 'The amount is held. Nothing has been proven yet.',
  },
  ACTIVE: {
    label: 'Active',
    tone: 'brass',
    text: 'text-brass-200',
    border: 'border-brass-300/40',
    bg: 'bg-brass-300/10',
    dot: 'bg-brass-300',
    hex: '#D9A441',
    description: 'Proof is arriving and being assessed.',
  },
  PARTIALLY_VERIFIED: {
    label: 'Partly proven',
    tone: 'ochre',
    text: 'text-ochre-300',
    border: 'border-ochre-400/40',
    bg: 'bg-ochre-400/10',
    dot: 'bg-ochre-300',
    hex: '#DCA95C',
    description: 'Some conditions are proven; others are still open.',
  },
  READY_TO_FULFILL: {
    label: 'Ready',
    tone: 'sage',
    text: 'text-sage-300',
    border: 'border-sage-400/50',
    bg: 'bg-sage-400/10',
    dot: 'bg-sage-300',
    hex: '#93B183',
    description: 'Every condition is proven. Awaiting the payer’s authorisation.',
  },
  FULFILLED: {
    label: 'Fulfilled',
    tone: 'sage',
    text: 'text-sage-300',
    border: 'border-sage-400/50',
    bg: 'bg-sage-400/15',
    dot: 'bg-sage-400',
    hex: '#7E9B6E',
    // "Released" is what fulfilment guarantees. Whether the payout reached the
    // recipient's bank is a separate, slower fact, reported on its own line.
    description: 'The promise was proven and the payment released.',
  },
  CONTESTED: {
    label: 'Contested',
    tone: 'rust',
    text: 'text-rust-300',
    border: 'border-rust-400/50',
    bg: 'bg-rust-400/10',
    dot: 'bg-rust-300',
    hex: '#D07A5E',
    description: 'Accounts disagree. The money stays conditional.',
  },
  EXPIRED: {
    label: 'Expired',
    tone: 'rust',
    text: 'text-rust-300',
    border: 'border-rust-400/40',
    bg: 'bg-rust-400/5',
    dot: 'bg-rust-400',
    hex: '#B4593F',
    description: 'The deadline passed with conditions unproven.',
  },
  CANCELLED: {
    label: 'Cancelled',
    tone: 'slate',
    text: 'text-paper-400',
    border: 'border-ink-300',
    bg: 'bg-ink-500/40',
    dot: 'bg-paper-400',
    hex: '#6F675A',
    description: 'Closed by the payer. Any held amount was returned.',
  },
};

export const statusMeta = (status) => PROMISE_STATUS_META[status] ?? { ...NEUTRAL, label: status ?? 'Unknown' };

export const CONDITION_STATUS_META = {
  PENDING: { label: 'Awaiting proof', text: 'text-paper-400', dot: 'bg-paper-400', hex: '#6F675A' },
  AWAITING_PROOF: { label: 'Proof filed', text: 'text-brass-200', dot: 'bg-brass-300', hex: '#D9A441' },
  VERIFYING: { label: 'Verifying', text: 'text-ochre-300', dot: 'bg-ochre-300', hex: '#DCA95C' },
  VERIFIED: { label: 'Verified', text: 'text-sage-300', dot: 'bg-sage-300', hex: '#93B183' },
  FAILED: { label: 'Failed', text: 'text-rust-300', dot: 'bg-rust-400', hex: '#B4593F' },
  CONTESTED: { label: 'Contested', text: 'text-rust-300', dot: 'bg-rust-300', hex: '#D07A5E' },
  WAIVED: { label: 'Waived', text: 'text-slate-300', dot: 'bg-slate-300', hex: '#8B9296' },
};

export const conditionMeta = (status) =>
  CONDITION_STATUS_META[status] ?? { label: status ?? '—', text: 'text-paper-400', dot: 'bg-paper-400', hex: '#6F675A' };

export const EVIDENCE_STATUS_META = {
  SUBMITTED: { label: 'Submitted', text: 'text-paper-200' },
  VERIFYING: { label: 'Being read', text: 'text-ochre-300' },
  ACCEPTED: { label: 'Supports', text: 'text-sage-300' },
  INSUFFICIENT: { label: 'Insufficient', text: 'text-ochre-300' },
  CONTRADICTED: { label: 'Contradicts', text: 'text-rust-300' },
  REJECTED: { label: 'Rejected', text: 'text-rust-300' },
};

export const evidenceMeta = (status) =>
  EVIDENCE_STATUS_META[status] ?? { label: status ?? '—', text: 'text-paper-300' };

/** The filter rail. Each entry maps to statuses the API actually returns. */
export const SPACE_FILTERS = [
  { key: 'ALL', label: 'All', statuses: null },
  { key: 'WAITING', label: 'Waiting', statuses: ['DRAFT', 'FUNDED'] },
  { key: 'VERIFYING', label: 'Verifying', statuses: ['ACTIVE', 'PARTIALLY_VERIFIED'] },
  { key: 'AT_RISK', label: 'At risk', statuses: ['EXPIRED'] },
  { key: 'READY', label: 'Ready', statuses: ['READY_TO_FULFILL'] },
  { key: 'FULFILLED', label: 'Fulfilled', statuses: ['FULFILLED'] },
  { key: 'CONTESTED', label: 'Contested', statuses: ['CONTESTED'] },
];

export const EVIDENCE_TYPES = [
  { value: 'url', label: 'Link' },
  { value: 'image', label: 'Image' },
  { value: 'screenshot', label: 'Screenshot' },
  { value: 'pdf', label: 'PDF' },
  { value: 'document', label: 'Document' },
  { value: 'invoice', label: 'Invoice' },
  { value: 'repository', label: 'Repository' },
  { value: 'test_report', label: 'Test report' },
  { value: 'delivery_confirmation', label: 'Delivery confirmation' },
  { value: 'note', label: 'Written note' },
];

export const CONDITION_TYPES = [
  { value: 'deliverable', label: 'Deliverable' },
  { value: 'approval', label: 'Approval' },
  { value: 'test', label: 'Test' },
  { value: 'milestone', label: 'Milestone' },
  { value: 'quality', label: 'Quality' },
  { value: 'timeline', label: 'Timeline' },
  { value: 'custom', label: 'Custom' },
];

export const VERIFICATION_METHODS = [
  { value: 'ai_assessment', label: 'Proof Engine assessment' },
  { value: 'document_review', label: 'Document review' },
  { value: 'url_check', label: 'Link check' },
  { value: 'test_report', label: 'Test report' },
  { value: 'participant_confirmation', label: 'Participant confirmation' },
  { value: 'manual_approval', label: 'Manual approval' },
];

export const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD'];

/**
 * A person-facing sentence for a payout, mirroring the server's version so a
 * promise loaded from the API reads the same as one just released.
 */
export function describePayout(payout) {
  switch (payout?.status) {
    case 'processed':
      return payout.utr
        ? `Paid to ${payout.destinationLabel ?? 'the recipient'} · UTR ${payout.utr}`
        : `Paid to ${payout.destinationLabel ?? 'the recipient'}`;
    case 'queued':
      return 'Queued — it will send when the balance covers it.';
    case 'pending':
    case 'processing':
      return 'On its way to the recipient\u2019s account.';
    case 'reversed':
      return 'The bank returned this payout. The money is back in the platform account.';
    case 'cancelled':
      return 'This payout was cancelled before it sent.';
    case 'rejected':
      return 'The provider rejected this payout.';
    case 'failed':
      return payout.failureReason ?? 'This payout did not go through.';
    default:
      return null;
  }
}
