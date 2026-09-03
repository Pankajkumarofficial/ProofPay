import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './config/env.js';
import routes from './routes/index.js';
import webhookRoutes from './routes/webhookRoutes.js';
import { notFound, errorHandler } from './middleware/error.js';
import { sanitizeRequest } from './middleware/sanitize.js';
import { apiLimiter } from './middleware/rateLimit.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * The built interface, when there is one.
 *
 * In development the Vite server runs the interface and proxies `/api` here, so
 * this directory does not exist and nothing below it happens. A deployment
 * builds it, and then one origin serves both halves — which is not merely
 * convenient. The browser client calls `/api` as a relative path, and the
 * session is a `sameSite: 'lax'` cookie: split the two across origins and the
 * cookie stops being sent, so every request arrives signed out.
 */
const CLIENT_DIST = path.resolve(here, '../../frontend/dist');
const CLIENT_INDEX = path.join(CLIENT_DIST, 'index.html');

/**
 * Razorpay Checkout is a script loaded from the provider, in an iframe that
 * talks to the provider. Helmet's default policy allows neither, so a build
 * that runs in `razorpay` mode would open a checkout that silently never
 * appears — and the default policy is applied only in production, which is the
 * one place nobody would see it first.
 */
const contentSecurityPolicy = {
  useDefaults: true,
  directives: {
    'script-src': ["'self'", 'https://checkout.razorpay.com'],
    'frame-src': ["'self'", 'https://api.razorpay.com', 'https://checkout.razorpay.com'],
    'connect-src': ["'self'", 'https://api.razorpay.com', 'https://lumberjack.razorpay.com'],
    'img-src': ["'self'", 'data:', 'https:'],
  },
};

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);

  app.use(
    helmet({
      // Proof files are served from this origin and embedded by the SPA.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: env.isDeployed ? contentSecurityPolicy : false,
    })
  );
  app.use(
    cors({
      origin: env.clientUrl,
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    })
  );
  /**
   * Webhooks are mounted before the JSON parser, and read as raw bytes.
   *
   * The provider signs the exact body it sent. Parsing it to an object and
   * re-serialising would produce different bytes — a reordered key or a
   * changed number format is enough — and the signature would never verify.
   * So this route gets the buffer, and nothing else on the app does.
   */
  app.use('/api/webhooks', express.raw({ type: 'application/json', limit: '1mb' }), webhookRoutes);

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(cookieParser());
  app.use(sanitizeRequest);

  // Uploaded proof. Served read-only; nothing here is executable.
  app.use(
    '/uploads',
    express.static(path.resolve(here, '../uploads'), {
      index: false,
      dotfiles: 'deny',
      setHeaders: (res) => res.setHeader('Content-Disposition', 'inline'),
    })
  );

  app.use('/api', apiLimiter, routes);

  if (fs.existsSync(CLIENT_INDEX)) {
    /*
     * Vite fingerprints every asset it emits, so those files are safe to keep
     * for a year — the name changes when the contents do. `index.html` is the
     * one file whose name never changes, and it is the file that names the
     * others: cache it and a browser will go on asking for the assets of the
     * build before last, which a deploy has already deleted.
     */
    app.use(
      express.static(CLIENT_DIST, {
        index: false,
        maxAge: '1y',
        setHeaders: (res, filePath) => {
          if (filePath === CLIENT_INDEX) res.setHeader('Cache-Control', 'no-store');
        },
      })
    );

    // The interface routes on the client, so a deep link typed into the address
    // bar is served the same shell and resolved there. Everything the API owns
    // is left alone, so a mistyped endpoint still answers as an API 404 rather
    // than quietly returning a page.
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
      res.setHeader('Cache-Control', 'no-store');
      res.sendFile(CLIENT_INDEX, (error) => (error ? next() : undefined));
    });
  }

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
