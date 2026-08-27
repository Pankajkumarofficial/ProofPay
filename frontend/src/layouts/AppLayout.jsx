import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Orbit, PlusCircle, Archive, BarChart3, ScrollText, Scale, Bell, User as UserIcon,
  Menu, X, Search, LogOut, Sparkles,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useLiveUpdates, usePoll } from '../hooks/useLiveUpdates.js';
import { useDebounced } from '../hooks/useDebounced.js';
import { notificationApi } from '../services/notificationApi.js';
import { promiseApi } from '../services/promiseApi.js';
import { Avatar } from '../components/UI/Avatar.jsx';
import { formatMoney, relativeTime } from '../utils/format.js';
import { statusMeta } from '../utils/status.js';

const NAV = [
  { to: '/space', label: 'Promise Space', icon: Orbit },
  { to: '/create', label: 'New Promise', icon: PlusCircle },
  { to: '/vault', label: 'Evidence Vault', icon: Archive },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/chronicle', label: 'Chronicle', icon: ScrollText },
  { to: '/contests', label: 'Contests', icon: Scale },
];

function Wordmark() {
  return (
    <Link to="/space" className="flex items-center gap-2.5">
      <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
        <circle cx="16" cy="16" r="10" fill="none" stroke="#D9A441" strokeWidth="1.5" />
        <circle cx="16" cy="16" r="4" fill="none" stroke="#D9A441" strokeWidth="1.5" />
        <path d="M16 2v4M16 26v4M2 16h4M26 16h4" stroke="#D9A441" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <span className="font-display text-[17px] tracking-tight text-paper-50">ProofPay</span>
    </Link>
  );
}

/** Search runs against the database, never against a list already on screen. */
function GlobalSearch({ onNavigate }) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(term, 260);

  useEffect(() => {
    let cancelled = false;
    if (debounced.trim().length < 2) {
      setResults([]);
      return undefined;
    }
    promiseApi
      .search(debounced.trim())
      .then((data) => !cancelled && setResults(data.promises ?? []))
      .catch(() => !cancelled && setResults([]));
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  return (
    <div className="relative flex-1 max-w-md">
      <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-paper-400" strokeWidth={1.75} />
      <input
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 160)}
        placeholder="Search promises, people, amounts, IDs"
        className="w-full border border-ink-300 bg-ink-800/70 py-2 pl-9 pr-3 text-[13px] text-paper-50 placeholder:text-paper-400/70 focus:border-brass-300/60 focus:outline-none"
      />
      <AnimatePresence>
        {open && term.trim().length >= 2 ? (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute left-0 right-0 top-full z-50 mt-1 max-h-80 overflow-y-auto border border-ink-300 bg-ink-700 shadow-lift"
          >
            {results.length ? (
              results.map((promise) => (
                <button
                  key={promise._id}
                  type="button"
                  onMouseDown={() => {
                    onNavigate(`/promises/${promise._id}`);
                    setTerm('');
                  }}
                  className="flex w-full items-center justify-between gap-3 border-b border-ink-300/50 px-3.5 py-2.5 text-left last:border-0 hover:bg-ink-500/50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] text-paper-50">{promise.title}</span>
                    <span className="font-mono text-[10px] uppercase tracking-wider text-paper-400">
                      {promise.publicId} · {promise.recipient?.name}
                    </span>
                  </span>
                  <span className="tnum shrink-0 font-mono text-[11px]" style={{ color: statusMeta(promise.status).hex }}>
                    {formatMoney(promise.amount, promise.currency, { compact: true })}
                  </span>
                </button>
              ))
            ) : (
              <p className="px-3.5 py-4 text-[12px] text-paper-400">No promises match that.</p>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState({ notifications: [], unreadCount: 0 });

  const load = () => notificationApi.list({ limit: 12 }).then(setState).catch(() => {});

  useEffect(() => {
    load();
  }, []);
  useLiveUpdates(load);
  usePoll(load, 60000);

  const markAll = async () => {
    await notificationApi.markAllRead().catch(() => {});
    load();
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        onBlur={() => setTimeout(() => setOpen(false), 180)}
        className="relative flex h-9 w-9 items-center justify-center border border-ink-300 text-paper-300 transition-colors hover:border-paper-400/50 hover:text-paper-50"
        aria-label={`Notifications${state.unreadCount ? `, ${state.unreadCount} unread` : ''}`}
      >
        <Bell size={15} strokeWidth={1.6} />
        {state.unreadCount > 0 ? (
          <span className="tnum absolute -right-1.5 -top-1.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-brass-300 px-1 font-mono text-[9px] text-ink-900">
            {state.unreadCount > 9 ? '9+' : state.unreadCount}
          </span>
        ) : null}
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="absolute right-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] border border-ink-300 bg-ink-700 shadow-lift"
          >
            <div className="flex items-center justify-between border-b border-ink-300/60 px-3.5 py-2.5">
              <span className="eyebrow">Notifications</span>
              {state.unreadCount ? (
                <button type="button" onMouseDown={markAll} className="font-mono text-[10px] uppercase tracking-wider text-brass-200 hover:text-brass-100">
                  Mark all read
                </button>
              ) : null}
            </div>
            <div className="max-h-96 overflow-y-auto">
              {state.notifications.length ? (
                state.notifications.map((notification) => (
                  <div
                    key={notification._id}
                    className={`border-b border-ink-300/40 px-3.5 py-3 last:border-0 ${notification.read ? 'opacity-60' : ''}`}
                  >
                    <p className="flex items-center gap-2 text-[13px] text-paper-50">
                      {!notification.read ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brass-300" /> : null}
                      {notification.title}
                    </p>
                    {notification.body ? (
                      <p className="mt-1 text-[12px] leading-relaxed text-paper-300">{notification.body}</p>
                    ) : null}
                    <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-paper-400">
                      {relativeTime(notification.createdAt)}
                    </p>
                  </div>
                ))
              ) : (
                <p className="px-3.5 py-6 text-center text-[12px] text-paper-400">Nothing yet.</p>
              )}
            </div>
            <Link
              to="/notifications"
              className="block border-t border-ink-300/60 px-3.5 py-2.5 text-center font-mono text-[10px] uppercase tracking-wider text-paper-300 hover:text-paper-50"
            >
              See all
            </Link>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export function AppLayout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => setMenuOpen(false), [location.pathname]);

  const navigateTo = (path) => navigate(path);

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[15rem_1fr]">
      {/* Rail */}
      <aside className="hidden border-r border-ink-300/60 bg-ink-900/60 lg:flex lg:h-screen lg:flex-col lg:sticky lg:top-0">
        <div className="border-b border-ink-300/60 px-5 py-5">
          <Wordmark />
          <p className="mt-2 font-mono text-[9px] uppercase leading-relaxed tracking-widest text-paper-400">
            Money moves when
            <br />
            the promise is proven
          </p>
        </div>

        <nav className="flex-1 overflow-y-auto py-3">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `relative flex items-center gap-3 px-5 py-2.5 text-[13px] transition-colors ${
                  isActive ? 'text-paper-50' : 'text-paper-300 hover:text-paper-50'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive ? <span className="absolute inset-y-1 left-0 w-[2px] bg-brass-300" /> : null}
                  <item.icon size={15} strokeWidth={1.6} className={isActive ? 'text-brass-300' : ''} />
                  {item.label}
                </>
              )}
            </NavLink>
          ))}

          <div className="mx-5 my-3 rule" />

          <NavLink
            to="/judge"
            className={({ isActive }) =>
              `mx-5 flex items-center gap-2.5 border px-3 py-2.5 text-[12px] transition-colors ${
                isActive
                  ? 'border-brass-300/60 bg-brass-300/10 text-brass-100'
                  : 'border-ink-300 text-paper-300 hover:border-brass-300/50 hover:text-brass-100'
              }`
            }
          >
            <Sparkles size={14} strokeWidth={1.6} />
            Judge Mode
          </NavLink>
        </nav>

        <div className="border-t border-ink-300/60 p-3">
          <Link
            to="/profile"
            className="flex items-center gap-3 px-2 py-2 transition-colors hover:bg-ink-500/40"
          >
            <Avatar user={user} size={30} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] text-paper-50">{user?.name}</span>
              <span className="block truncate font-mono text-[10px] text-paper-400">{user?.email}</span>
            </span>
          </Link>
          <button
            type="button"
            onClick={() => signOut().then(() => navigate('/signin'))}
            className="mt-1 flex w-full items-center gap-2.5 px-2 py-2 font-mono text-[10px] uppercase tracking-wider text-paper-400 transition-colors hover:text-paper-50"
          >
            <LogOut size={13} strokeWidth={1.6} />
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex min-h-screen min-w-0 flex-col">
        <header className="sticky top-0 z-40 border-b border-ink-300/60 bg-ink-800/90 backdrop-blur">
          <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="flex h-9 w-9 items-center justify-center border border-ink-300 text-paper-300 lg:hidden"
              aria-label="Open menu"
            >
              <Menu size={15} strokeWidth={1.6} />
            </button>
            <div className="lg:hidden">
              <Wordmark />
            </div>
            <div className="hidden flex-1 sm:flex">
              <GlobalSearch onNavigate={navigateTo} />
            </div>
            <div className="ml-auto flex items-center gap-2">
              <NotificationBell />
              <Link to="/profile" className="lg:hidden">
                <Avatar user={user} size={34} />
              </Link>
            </div>
          </div>
          <div className="border-t border-ink-300/50 px-4 py-2 sm:hidden">
            <GlobalSearch onNavigate={navigateTo} />
          </div>
        </header>

        <main className="flex-1">
          <Outlet />
        </main>
      </div>

      {/* Mobile drawer */}
      <AnimatePresence>
        {menuOpen ? (
          <div className="fixed inset-0 z-[80] lg:hidden">
            <motion.button
              type="button"
              aria-label="Close menu"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMenuOpen(false)}
              className="absolute inset-0 bg-ink-900/80 backdrop-blur-sm"
            />
            <motion.aside
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ duration: 0.26, ease: [0.2, 0.8, 0.2, 1] }}
              className="absolute inset-y-0 left-0 flex w-[17rem] flex-col border-r border-ink-300 bg-ink-900"
            >
              <div className="flex items-center justify-between border-b border-ink-300/60 px-5 py-4">
                <Wordmark />
                <button type="button" onClick={() => setMenuOpen(false)} className="text-paper-400" aria-label="Close">
                  <X size={16} strokeWidth={1.6} />
                </button>
              </div>
              <nav className="flex-1 overflow-y-auto py-3">
                {[...NAV, { to: '/judge', label: 'Judge Mode', icon: Sparkles }].map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-5 py-3 text-[14px] ${isActive ? 'text-brass-200' : 'text-paper-200'}`
                    }
                  >
                    <item.icon size={16} strokeWidth={1.6} />
                    {item.label}
                  </NavLink>
                ))}
              </nav>
              <div className="border-t border-ink-300/60 p-4">
                <Link to="/profile" className="flex items-center gap-3">
                  <Avatar user={user} size={32} />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] text-paper-50">{user?.name}</span>
                    <span className="block truncate font-mono text-[10px] text-paper-400">{user?.email}</span>
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={() => signOut().then(() => navigate('/signin'))}
                  className="mt-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-paper-400"
                >
                  <LogOut size={13} strokeWidth={1.6} /> Sign out
                </button>
              </div>
            </motion.aside>
          </div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
