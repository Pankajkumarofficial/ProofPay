/**
 * Paint the right theme on the very first frame.
 *
 * React cannot do this: by the time it mounts, the browser has already painted,
 * and a dark app that flashes white for 200ms on every load looks broken. So the
 * stored preference is read and stamped here, before the stylesheet is applied.
 * ThemeContext writes the same attribute afterwards and agrees with it — this is
 * the only copy of the logic that has to run synchronously, and it deliberately
 * never throws.
 *
 * It is a file rather than an inline block because the deployed Content Security
 * Policy allows `script-src 'self'` and no inline script. Inlined, it is blocked
 * on the deployed site and nowhere else — the one place a theme flash would not
 * be seen before release. Loaded without `defer`, so it still runs before paint.
 */
(function () {
  try {
    var saved = localStorage.getItem('proofpay.theme');
    var preference = saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system';
    var resolved =
      preference === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : preference;
    document.documentElement.dataset.theme = resolved;
    document
      .querySelector('meta[name="theme-color"]')
      .setAttribute('content', resolved === 'dark' ? '#0A0908' : '#F5F1E8');
  } catch (error) {
    document.documentElement.dataset.theme = 'dark';
  }
})();
