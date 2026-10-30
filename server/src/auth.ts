import type { Request, Response, NextFunction, Router } from 'express';
import { Router as createRouter } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { AuthResponse, UserPublic } from '@kcd2dice/shared';
import { toUserPublic, type UserRecord, type UserStore } from './store';

const USERNAME_MIN = 3;
const USERNAME_MAX = 20;
const PASSWORD_MIN = 6;
const TOKEN_TTL = '7d';

export interface AuthedRequest extends Request {
  user?: UserRecord;
}

function fail(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ error: { code, message } });
}

function readCredentials(body: unknown): { username: string; password: string } | { code: string; message: string } {
  if (!body || typeof body !== 'object') return { code: 'BAD_INPUT', message: 'body 必须是 JSON 对象' };
  const o = body as Record<string, unknown>;
  const username = o.username;
  const password = o.password;
  if (typeof username !== 'string' || typeof password !== 'string') {
    return { code: 'BAD_INPUT', message: 'username 与 password 必填且为字符串' };
  }
  const name = username.trim();
  if (name.length < USERNAME_MIN || name.length > USERNAME_MAX) {
    return { code: 'BAD_INPUT', message: `用户名长度需在 ${USERNAME_MIN}-${USERNAME_MAX} 字符之间` };
  }
  if (!/^[A-Za-z0-9_\u4e00-\u9fa5-]+$/.test(name)) {
    return { code: 'BAD_INPUT', message: '用户名只允许字母、数字、下划线、连字符与中文' };
  }
  if (password.length < PASSWORD_MIN) {
    return { code: 'BAD_INPUT', message: `密码至少 ${PASSWORD_MIN} 位` };
  }
  return { username: name, password };
}

export function signToken(secret: string, user: UserRecord): string {
  return jwt.sign({ sub: user.id, username: user.username }, secret, { expiresIn: TOKEN_TTL });
}

export function verifyToken(secret: string, token: string): string | null {
  try {
    const payload = jwt.verify(token, secret);
    if (typeof payload === 'string' || payload === null) return null;
    const sub = (payload as jwt.JwtPayload).sub;
    return typeof sub === 'string' ? sub : null;
  } catch {
    return null;
  }
}

/** 从 Authorization: Bearer <token> 解析出用户 */
export function bearerUser(store: UserStore, secret: string, req: Request): UserRecord | null {
  const header = req.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(.*)$/i.exec(header.trim());
  if (!match) return null;
  const userId = verifyToken(secret, match[1]!.trim());
  if (!userId) return null;
  return store.findById(userId) ?? null;
}

export function createAuthRouter(store: UserStore, secret: string): Router {
  const router = createRouter();
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  router.post('/register', (req: Request, res: Response) => {
    const creds = readCredentials(req.body);
    if ('code' in creds) return fail(res, 400, creds.code, creds.message);
    if (store.findByUsername(creds.username)) {
      return fail(res, 409, 'BAD_INPUT', '用户名已被占用');
    }
    const passwordHash = bcrypt.hashSync(creds.password, 10);
    const user = store.create({ username: creds.username, passwordHash });
    const body: AuthResponse = { token: signToken(secret, user), user: toUserPublic(user) };
    res.status(201).json(body);
  });

  router.post('/login', (req: Request, res: Response) => {
    const creds = readCredentials(req.body);
    if ('code' in creds) return fail(res, 400, creds.code, creds.message);
    const user = store.findByUsername(creds.username);
    if (!user || !bcrypt.compareSync(creds.password, user.passwordHash)) {
      return fail(res, 401, 'AUTH_INVALID', '用户名或密码错误');
    }
    const body: AuthResponse = { token: signToken(secret, user), user: toUserPublic(user) };
    res.json(body);
  });

  return router;
}

export function requireAuth(store: UserStore, secret: string) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    const user = bearerUser(store, secret, req);
    if (!user) {
      fail(res, 401, 'AUTH_INVALID', '缺少或无效的 Bearer token');
      return;
    }
    req.user = user;
    next();
  };
}

export function publicUser(user: UserRecord): UserPublic {
  return toUserPublic(user);
}
