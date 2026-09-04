import { useEffect, useState } from 'react';
import { initials } from '../../utils/format.js';

/**
 * Shows the stored profile image when the account has one, initials otherwise.
 *
 * "Has one" means the image actually loads, not merely that a URL is recorded.
 * Portraits uploaded before files were kept in the database point at a
 * filesystem the host wipes on every redeploy, and a Google picture can be
 * withdrawn or blocked — in every one of those cases `user.avatar` is a
 * perfectly good-looking string for an image that will never arrive. Rendering
 * it unconditionally leaves a broken-image glyph in the sidebar and beside
 * every piece of proof, which reads as a broken app rather than an absent
 * photo. Initials are the honest answer, and they are already the answer for
 * somebody who never set one.
 */
export function Avatar({ user, size = 32, className = '' }) {
  const dimension = { width: size, height: size };
  const src = user?.avatar ?? null;
  const [failed, setFailed] = useState(false);

  // A new portrait, or a different person in a re-used slot, deserves a fresh
  // attempt — otherwise one failure would outlive the URL that caused it.
  useEffect(() => setFailed(false), [src]);

  if (src && !failed) {
    return (
      <img
        src={src}
        alt={user.name ?? 'Profile'}
        style={dimension}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={`shrink-0 rounded-full border border-ink-300 object-cover ${className}`}
      />
    );
  }

  return (
    <span
      style={{ ...dimension, fontSize: Math.max(10, size * 0.34) }}
      className={`flex shrink-0 items-center justify-center rounded-full border border-brass-300/40 bg-brass-300/10 font-mono uppercase tracking-wide text-brass-200 ${className}`}
    >
      {initials(user?.name ?? '?') || '?'}
    </span>
  );
}
