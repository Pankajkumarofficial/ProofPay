import { eventBus, CHANNEL } from '../services/eventBus.js';

/** Server-sent events for live promise updates. */
export const stream = (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`event: ready\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);

  const userId = String(req.user._id);
  const onUpdate = (payload) => {
    if (!payload.userIds.includes(userId)) return;
    res.write(`event: update\ndata: ${JSON.stringify({ type: payload.type, data: payload.data, at: payload.at })}\n\n`);
  };
  eventBus.on(CHANNEL, onUpdate);

  // Comment frames keep proxies from closing an idle stream.
  const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    eventBus.off(CHANNEL, onUpdate);
    res.end();
  });
};
