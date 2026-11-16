import http from 'http';
import path from 'path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createChordApp } from './backend/src/app.ts';
import { ENV } from './backend/src/config/env.ts';
import { initSocketGateway } from './backend/src/websocket/socketGateway.ts';
import { startVoiceNodeMonitor } from './backend/src/voice/voiceNodeService.ts';

async function startServer() {
  const app = createChordApp();
  const httpServer = http.createServer(app);

  // Attach Socket.IO real-time & WebRTC signaling gateway on the same HTTP server
  initSocketGateway(httpServer);
  // Probe TURN relay health in the background (no-op on serverless platforms).
  startVoiceNodeMonitor();

  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const host = process.env.HOST || '127.0.0.1';
  httpServer.listen(ENV.PORT, host, () => {
    console.log(`Snout full-stack server listening on http://${host}:${ENV.PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Snout server:', err);
  process.exit(1);
});
