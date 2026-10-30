import http from 'node:http';
import type { AddressInfo } from 'node:net';
import cors from 'cors';
import express from 'express';
import { Server as IOServer } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@kcd2dice/shared';
import { bearerUser, createAuthRouter, publicUser, requireAuth } from './auth';
import { PORT } from './config';
import { GameHub } from './game';
import { UserStore, loadJwtSecret } from './store';

export function createApp(store: UserStore, secret: string): express.Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '64kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, uptime: process.uptime() });
  });
  app.use('/api/auth', createAuthRouter(store, secret));
  app.get('/api/me', requireAuth(store, secret), (req, res) => {
    const user = bearerUser(store, secret, req);
    if (!user) {
      res.status(401).json({ error: { code: 'AUTH_INVALID', message: '缺少或无效的 Bearer token' } });
      return;
    }
    res.json({ user: publicUser(user) });
  });

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'BAD_INPUT', message: '接口不存在' } });
  });
  return app;
}

export interface RunningServer {
  httpServer: http.Server;
  io: IOServer<ClientToServerEvents, ServerToClientEvents>;
  hub: GameHub;
  store: UserStore;
  port: number;
  close: () => Promise<void>;
}

export async function startServer(
  options: { dataDir?: string; port?: number; secret?: string } = {},
): Promise<RunningServer> {
  const store = new UserStore(options.dataDir);
  const secret = options.secret ?? loadJwtSecret(options.dataDir);
  const app = createApp(store, secret);
  const httpServer = http.createServer(app);
  const io = new IOServer<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: '*' },
  });
  const hub = new GameHub(io, store, secret);

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(options.port ?? PORT, () => resolve());
  });
  const port = (httpServer.address() as AddressInfo).port;

  const close = (): Promise<void> =>
    new Promise((resolve) => {
      hub.dispose();
      io.close();
      if (httpServer.listening) httpServer.close(() => resolve());
      else resolve();
    });

  return { httpServer, io, hub, store, port, close };
}

const entry = process.argv[1] ?? '';
if (/index\.(ts|js)$/.test(entry)) {
  startServer()
    .then((running) => {
      console.log(`[kcd2dice] server listening on http://localhost:${running.port}`);
      console.log(`[kcd2dice] data file: ${running.store.path}`);
    })
    .catch((e: unknown) => {
      console.error('[kcd2dice] 启动失败', e);
      process.exitCode = 1;
    });
}
