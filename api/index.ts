import type { IncomingMessage, ServerResponse } from 'http';

let appPromise: Promise<any> | null = null;
let loadError: any = null;

async function getApp() {
  if (loadError) throw loadError;
  if (!appPromise) {
    appPromise = (async () => {
      const mod = await import('../backend/src/app.ts');
      return mod.createChordApp();
    })().catch((err) => {
      loadError = err;
      appPromise = null;
      throw err;
    });
  }
  return appPromise;
}

export default async function handler(req: IncomingMessage & { query?: Record<string, unknown> }, res: ServerResponse) {
  try {
    const urlObj = new URL(req.url || '/', 'http://localhost');
    const rewritten = (typeof req.query?.path === 'string' ? req.query.path : urlObj.searchParams.get('path')) || '';
    if (rewritten) {
      const params = new URLSearchParams(urlObj.search);
      params.delete('path');
      const rest = params.toString();
      req.url = `/api/${rewritten}${rest ? `?${rest}` : ''}`;
    }

    const app = await getApp();
    return app(req, res);
  } catch (err: any) {
    const message = err?.message || String(err);
    console.error('Vercel function load failed:', err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      error: message,
      message,
      stack: err?.stack || null,
    }));
  }
}
