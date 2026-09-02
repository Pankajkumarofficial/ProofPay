import { Link } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { Button } from '../components/UI/Button.jsx';
import { Loading, ErrorState, EmptyState } from '../components/UI/States.jsx';
import { useApi } from '../hooks/useApi.js';
import { useLiveUpdates } from '../hooks/useLiveUpdates.js';
import { notificationApi } from '../services/notificationApi.js';
import { formatMoney, relativeTime, formatDate } from '../utils/format.js';

const SEVERITY = {
  success: 'border-l-sage-400',
  warning: 'border-l-ochre-400',
  critical: 'border-l-rust-400',
  info: 'border-l-brass-300',
};

export function Notifications() {
  const feed = useApi(() => notificationApi.list({ limit: 100 }), []);
  useLiveUpdates(() => feed.refresh());

  const notifications = feed.data?.notifications ?? [];

  const markAll = async () => {
    await notificationApi.markAllRead().catch(() => {});
    feed.refresh();
  };

  const markOne = async (id) => {
    await notificationApi.markRead(id).catch(() => {});
    feed.refresh();
  };

  if (feed.loading) return <Loading label="Loading notifications…" className="min-h-[60vh]" />;
  if (feed.error) return <ErrorState error={feed.error} onRetry={feed.reload} className="min-h-[60vh]" />;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label">Notifications</p>
          <h1 className="mt-1.5 font-display text-[28px] leading-tight text-paper-50">
            {feed.data.unreadCount ? `${feed.data.unreadCount} unread` : 'All caught up'}
          </h1>
        </div>
        {feed.data.unreadCount ? (
          <Button variant="ghost" icon={CheckCheck} onClick={markAll}>
            Mark all read
          </Button>
        ) : null}
      </header>

      <div className="mt-6">
        {notifications.length ? (
          <div className="space-y-2">
            {notifications.map((notification) => {
              const body = (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
                    <p className="flex items-center gap-2 text-[14px] text-paper-50">
                      {!notification.read ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brass-300" /> : null}
                      {notification.title}
                    </p>
                    <span
                      className="shrink-0 label text-paper-400"
                      title={formatDate(notification.createdAt, { withTime: true })}
                    >
                      {relativeTime(notification.createdAt)}
                    </span>
                  </div>
                  {notification.body ? (
                    <p className="mt-1.5 text-[13px] leading-relaxed text-paper-300">{notification.body}</p>
                  ) : null}
                  {notification.promise ? (
                    <p className="mt-2 label text-paper-400">
                      {notification.promise.title} ·{' '}
                      {formatMoney(notification.promise.amount, notification.promise.currency)}
                    </p>
                  ) : null}
                </>
              );

              const className = `block border border-ink-300/60 border-l-2 bg-ink-700/40 p-4 transition-colors hover:bg-ink-500/40 ${
                SEVERITY[notification.severity] ?? SEVERITY.info
              } ${notification.read ? 'opacity-60' : ''}`;

              return notification.promise ? (
                <Link
                  key={notification._id}
                  to={`/promises/${notification.promise._id}`}
                  onClick={() => !notification.read && markOne(notification._id)}
                  className={className}
                >
                  {body}
                </Link>
              ) : (
                <div key={notification._id} className={className}>
                  {body}
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={Bell}
            title="No notifications yet"
            body="ProofPay tells you when proof arrives, when a condition is verified, when health changes, and when a promise is ready."
          />
        )}
      </div>
    </div>
  );
}
