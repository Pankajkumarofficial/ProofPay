import crypto from 'node:crypto';

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** Human-quotable public identifier, e.g. PRM-7F3K-9QX2. */
export function publicId(prefix = 'PRM') {
  const block = (len) =>
    Array.from(crypto.randomBytes(len))
      .map((byte) => ALPHABET[byte % ALPHABET.length])
      .join('');
  return `${prefix}-${block(4)}-${block(4)}`;
}

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');
