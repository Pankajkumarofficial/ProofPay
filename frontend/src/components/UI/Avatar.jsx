import { initials } from '../../utils/format.js';

/** Shows the stored profile image when the account has one, initials otherwise. */
export function Avatar({ user, size = 32, className = '' }) {
  const dimension = { width: size, height: size };

  if (user?.avatar) {
    return (
      <img
        src={user.avatar}
        alt={user.name ?? 'Profile'}
        style={dimension}
        referrerPolicy="no-referrer"
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
