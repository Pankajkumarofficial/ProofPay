import { useEffect, useRef } from 'react';

/**
 * One connection to the API's event stream, shared by everything that listens.
 *
 * The stream only ever carries a nudge; a subscriber is expected to refetch, so
 * a dropped connection degrades to stale-until-next-action rather than to wrong
 * data.
 *
 * The sharing is not an optimisation. Each EventSource holds an HTTP connection
 * open for as long as it lives, and a browser allows only six per origin over
 * HTTP/1.1. A page that mounts the shell, its notification bell and its own
 * subscriber was opening three of them; every further fetch then queued behind
 * whatever was left, and the interface reported the API as unreachable while the
 * API was answering in milliseconds. So the connection belongs to the module,
 * and components subscribe to it.
 */

const ENDPOINT = '/api/stream';

/** Callbacks to hand each event to. The connection lives while this is non-empty. */
const subscribers = new Set();

let source = null;
let retry = null;
let attempts = 0;

function broadcast(payload) {
  for (const subscriber of subscribers) {
    try {
      subscriber(payload);
    } catch {
      // One listener throwing must not deafen the others.
    }
  }
}

function connect() {
  if (source || typeof EventSource === 'undefined' || !subscribers.size) return;

  source = new EventSource(ENDPOINT, { withCredentials: true });

  source.addEventListener('update', (event) => {
    try {
      broadcast(JSON.parse(event.data));
    } catch {
      broadcast({ type: 'unknown' });
    }
  });

  source.addEventListener('open', () => {
    attempts = 0;
  });

  source.onerror = () => {
    source?.close();
    source = null;
    if (!subscribers.size) return;
    attempts += 1;
    // Back off, but never give up entirely — tabs are left open for hours.
    retry = setTimeout(connect, Math.min(30000, 1000 * 2 ** attempts));
  };
}

function releaseIfIdle() {
  if (subscribers.size) return;
  clearTimeout(retry);
  retry = null;
  attempts = 0;
  source?.close();
  source = null;
}

/**
 * Calls back when something the user can see has changed. Every caller shares
 * the one connection; the last one to unmount closes it.
 */
export function useLiveUpdates(onUpdate, { enabled = true } = {}) {
  const handler = useRef(onUpdate);
  handler.current = onUpdate;

  useEffect(() => {
    if (!enabled) return undefined;

    const subscriber = (payload) => handler.current?.(payload);
    subscribers.add(subscriber);
    connect();

    return () => {
      subscribers.delete(subscriber);
      releaseIfIdle();
    };
  }, [enabled]);
}

/** A slow poll, as the safety net behind the stream. */
export function usePoll(callback, intervalMs = 45000, { enabled = true } = {}) {
  const handler = useRef(callback);
  handler.current = callback;

  useEffect(() => {
    if (!enabled) return undefined;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') handler.current?.();
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled]);
}
