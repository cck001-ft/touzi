import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import type {
  Ack,
  AuthPayload,
  AuthResponse,
  ClientToServerEvents,
  RoomState,
  ServerToClientEvents,
  UserPublic,
} from '@shared/types';

const TOKEN_KEY = 'kcd2dice.token';
const USER_KEY = 'kcd2dice.user';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
export type RoomPayload = Parameters<ClientToServerEvents['createRoom']>[0];
export type JoinPayload = Parameters<ClientToServerEvents['joinRoom']>[0];

export interface CreateRoomInput {
  wager: number;
  targetScore: number;
  diceSet: string[];
  badge: string | null;
}

// ---------- 会话（localStorage） ----------

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function saveSession(res: AuthResponse): void {
  try {
    localStorage.setItem(TOKEN_KEY, res.token);
    localStorage.setItem(USER_KEY, JSON.stringify(res.user));
  } catch {
    /* 隐私模式下忽略 */
  }
}

export function loadUser(): UserPublic | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as UserPublic) : null;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    /* ignore */
  }
}

// ---------- REST 认证 ----------

async function postAuth(path: 'register' | 'login', payload: AuthPayload): Promise<AuthResponse> {
  let res: Response;
  try {
    res = await fetch(`/api/auth/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error('无法连接服务器，请确认后端已启动');
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const rec = (data ?? {}) as { error?: { message?: string }; message?: string };
    throw new Error(rec.error?.message ?? rec.message ?? `请求失败（HTTP ${res.status}）`);
  }
  return data as AuthResponse;
}

export function register(payload: AuthPayload): Promise<AuthResponse> {
  return postAuth('register', payload);
}

export function login(payload: AuthPayload): Promise<AuthResponse> {
  return postAuth('login', payload);
}

// ---------- Socket ----------

export function connectSocket(token: string): AppSocket {
  return io('/', { auth: { token } });
}

function withAck<T>(apply: (cb: (r: Ack<T>) => void) => void, timeoutMs = 8000): Promise<Ack<T>> {
  return new Promise<Ack<T>>((resolve) => {
    let done = false;
    const finish = (r: Ack<T>) => {
      if (done) return;
      done = true;
      resolve(r);
    };
    apply(finish);
    window.setTimeout(
      () => finish({ ok: false, error: { code: 'TIMEOUT', message: '服务器无响应，请稍后再试' } }),
      timeoutMs,
    );
  });
}

export function createRoom(socket: AppSocket, input: CreateRoomInput): Promise<Ack<RoomState>> {
  const payload: RoomPayload = {
    wager: input.wager,
    targetScore: input.targetScore,
    diceSet: input.diceSet,
    badge: input.badge,
  };
  return withAck<RoomState>((cb) => socket.emit('createRoom', payload, cb));
}

export function joinRoom(socket: AppSocket, input: { roomCode: string; diceSet: string[]; badge: string | null }): Promise<Ack<RoomState>> {
  const payload: JoinPayload = { roomCode: input.roomCode.trim(), diceSet: input.diceSet, badge: input.badge };
  return withAck<RoomState>((cb) => socket.emit('joinRoom', payload, cb));
}

export const roomActions = {
  setReady: (socket: AppSocket, ready: boolean) => socket.emit('setReady', { ready }),
  toggleSelect: (socket: AppSocket, index: number) => socket.emit('toggleSelect', { index }),
  rollDice: (socket: AppSocket) => socket.emit('rollDice'),
  bankAndPass: (socket: AppSocket) => socket.emit('bankAndPass'),
  useBadge: (socket: AppSocket) => socket.emit('useBadge'),
  forfeit: (socket: AppSocket) => socket.emit('forfeit'),
  leaveRoom: (socket: AppSocket) => socket.emit('leaveRoom'),
};
