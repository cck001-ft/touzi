import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { UserPublic } from '@kcd2dice/shared';
import { DATA_DIR, STARTING_COINS } from './config';

export interface UserRecord {
  id: string;
  username: string;
  usernameKey: string;
  passwordHash: string;
  coins: number;
  wins: number;
  losses: number;
  createdAt: string;
}

interface StoreFile {
  version: 1;
  users: UserRecord[];
}

export function toUserPublic(u: UserRecord): UserPublic {
  return { id: u.id, username: u.username, coins: u.coins, wins: u.wins, losses: u.losses };
}

export class UserStore {
  private readonly dir: string;
  private readonly file: string;
  private users: UserRecord[] = [];

  constructor(dir: string = DATA_DIR) {
    this.dir = dir;
    this.file = path.join(dir, 'users.json');
    this.load();
  }

  private load(): void {
    fs.mkdirSync(this.dir, { recursive: true });
    if (!fs.existsSync(this.file)) {
      this.users = [];
      this.flush();
      return;
    }
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<StoreFile>;
      this.users = Array.isArray(raw.users) ? raw.users.filter(isUserRecord) : [];
    } catch {
      this.users = [];
    }
  }

  private flush(): void {
    fs.mkdirSync(this.dir, { recursive: true });
    const body: StoreFile = { version: 1, users: this.users };
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, this.file);
  }

  get path(): string {
    return this.file;
  }

  all(): UserRecord[] {
    return this.users.map((u) => ({ ...u }));
  }

  findById(id: string): UserRecord | undefined {
    return this.users.find((u) => u.id === id);
  }

  findByUsername(username: string): UserRecord | undefined {
    const key = username.trim().toLowerCase();
    return this.users.find((u) => u.usernameKey === key);
  }

  create(input: { username: string; passwordHash: string }): UserRecord {
    const user: UserRecord = {
      id: crypto.randomUUID(),
      username: input.username.trim(),
      usernameKey: input.username.trim().toLowerCase(),
      passwordHash: input.passwordHash,
      coins: STARTING_COINS,
      wins: 0,
      losses: 0,
      createdAt: new Date().toISOString(),
    };
    this.users.push(user);
    this.flush();
    return user;
  }

  setCoins(id: string, coins: number): UserRecord | undefined {
    const u = this.findById(id);
    if (!u) return undefined;
    u.coins = coins;
    this.flush();
    return u;
  }

  recordResult(id: string, won: boolean): UserRecord | undefined {
    const u = this.findById(id);
    if (!u) return undefined;
    if (won) u.wins += 1;
    else u.losses += 1;
    this.flush();
    return u;
  }
}

function isUserRecord(v: unknown): v is UserRecord {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.username === 'string' &&
    typeof o.usernameKey === 'string' &&
    typeof o.passwordHash === 'string' &&
    typeof o.coins === 'number' &&
    typeof o.wins === 'number' &&
    typeof o.losses === 'number'
  );
}

/** JWT 密钥：优先环境变量，否则落盘复用，保证服务重启后旧 token 仍有效 */
export function loadJwtSecret(dir: string = DATA_DIR): string {
  const fromEnv = process.env.KCD2_JWT_SECRET;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'jwt-secret.txt');
  if (fs.existsSync(file)) {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing.length >= 32) return existing;
  }
  const secret = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(file, `${secret}\n`, 'utf8');
  return secret;
}
