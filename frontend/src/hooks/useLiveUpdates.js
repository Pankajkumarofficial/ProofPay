import { useEffect, useRef } from 'react';

/**
 * Subscribes to the API's event stream and calls back when something the user
 * can see has changed. The stream only ever carries a nudge; the callback is
 * expected to refetch, so a dropped connection degrades to stale-until-next-
 * action rather than to wrong data.
 */
export function useLiveUpdates(onUpdate, { enabled = true } = {}) {
  const handler = useRef(onUpdate);
  handler.current = onUpdate;

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return undefined;

    let source;
    let retry;
    let attempts = 0;
    let closed = false;

    const connect = () => {
      source = new EventSource('/api/stream', { withCredentials: true });

      source.addEventListener('update', (event) => {
        try {
          handler.current?.(JSON.parse(event.data));
        } catch {
          handler.current?.({ type: 'unknown' });
        }
      });

      source.addEventListener('open', () => {
        attempts = 0;
      });

      source.onerror = () => {
        source.close();
        if (closed) return;
        attempts += 1;
        // Back off, but never give up entirely — tabs are left open for hours.
        retry = setTimeout(connect, Math.min(30000, 1000 * 2 ** attempts));
      };
    };

    connect();

    return () => {
      closed = true;
      clearTimeout(retry);
      source?.close();
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
