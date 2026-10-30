import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io as ioClient, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ack, ClientToServerEvents, RoomState, ServerToClientEvents } from '@kcd2dice/shared';
import { startServer, type RunningServer } from '../src/index';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type CreatePayload = Parameters<ClientToServerEvents['createRoom']>[0];
type JoinPayload = Parameters<ClientToServerEvents['joinRoom']>[0];

interface ErrPayload {
  code: string;
  message: string;
}

interface Client {
  socket: ClientSocket;
  userId: string;
  username: string;
  version: number;
  state: RoomState | null;
  errors: ErrPayload[];
  events: string[];
}

let server: RunningServer;
let dataDir: string;
const clients: Client[] = [];

function baseUrl(): string {
  return `http://127.0.0.1:${server.port}`;
}

async function registerUser(username: string, password = 'pw123456') {
  const res = await fetch(`${baseUrl()}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { token: string; user: { id: string; username: string } };
}

async function connectClient(username: string): Promise<Client> {
  const auth = await registerUser(username);
  const socket: ClientSocket = ioClient(baseUrl(), {
    transports: ['websocket'],
    auth: { token: auth.token },
    forceNew: true,
  });
  const client: Client = {
    socket,
    userId: auth.user.id,
    username: auth.user.username,
    version: 0,
    state: null,
    errors: [],
    events: [],
  };
  socket.on('roomUpdate', (state) => {
    client.state = state;
    client.version += 1;
    if (state.lastEvent) client.events.push(state.lastEvent);
  });
  socket.on('error', (payload) => client.errors.push(payload));
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve());
    socket.once('connect_error', (e) => reject(new Error(String(e.message))));
  });
  clients.push(client);
  return client;
}

function waitVersion(client: Client, prev: number, timeoutMs = 4000): Promise<RoomState> {
  return new Promise<RoomState>((resolve, reject) => {
    const timer = setTimeout(() => {
      client.socket.off('roomUpdate', onUpdate);
      reject(new Error(`等待 roomUpdate 超时: ${JSON.stringify(client.errors)}`));
    }, timeoutMs);
    function onUpdate(state: RoomState): void {
      clearTimeout(timer);
      client.socket.off('roomUpdate', onUpdate);
      resolve(state);
    }
    client.socket.on('roomUpdate', onUpdate);
  });
}

/** 以 observer 客户端的视角执行一次动作并等待状态推进（避免读到陈旧状态） */
async function act(observer: Client, emit: () => void): Promise<RoomState> {
  const prev = observer.version;
  emit();
  return waitVersion(observer, prev);
}

function createRoom(client: Client, payload: CreatePayload): Promise<Ack<RoomState>> {
  return new Promise((resolve) => client.socket.emit('createRoom', payload, resolve));
}

function joinRoom(client: Client, payload: JoinPayload): Promise<Ack<RoomState>> {
  return new Promise((resolve) => client.socket.emit('joinRoom', payload, resolve));
}

async function toggleAll(observer: Client, actor: Client, indices: number[]): Promise<void> {
  for (const index of indices) {
    await act(observer, () => actor.socket.emit('toggleSelect', { index }));
  }
}

/**
 * 不幸骰（catalog.ts probs = [0.046, 0.227, 0.227, 0.227, 0.227, 0.046]）的取值区间：
 * r=0.01 → 面 1，0.1 → 面 2，0.3 → 面 3，0.6 → 面 4，0.98 → 面 6。
 * 循环 [2,3,4,6] 掷任意 1..6 颗都必然爆掉（无 1/5、同面无三颗、无顺子）。
 */
const BUST_SEQ = [0.1, 0.3, 0.6, 0.98];

function bustRoll(): () => number {
  let i = 0;
  return () => BUST_SEQ[i++ % BUST_SEQ.length]!;
}

/** 不幸骰下必出「1」，可组单 1 或三同点，必然不爆 */
const rollOnes = (): number => 0.01;

/** 用给定随机源驱动一次动作，使服务端掷骰结果可确定 */
async function actWithRandom(observer: Client, next: () => number, emit: () => void): Promise<RoomState> {
  const spy = vi.spyOn(Math, 'random').mockImplementation(next);
  try {
    return await act(observer, emit);
  } finally {
    spy.mockRestore();
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface DriveOptions {
  bankAt: number;
  useBadge: boolean;
  widest: boolean;
  maxSteps: number;
}

interface DriveResult {
  steps: number;
  banked: number;
  busts: number;
  badgeUsed: number;
  winnerId: string | null;
  finalState: RoomState;
  finished: boolean;
}

async function drive(clientsIn: Client[], opts: DriveOptions): Promise<DriveResult> {
  const observer = clientsIn[0]!;
  const result: DriveResult = {
    steps: 0,
    banked: 0,
    busts: 0,
    badgeUsed: 0,
    winnerId: null,
    finalState: observer.state!,
    finished: false,
  };

  for (const c of clientsIn) {
    const seat = c.state?.players.find((p) => p.id === c.userId);
    if (c.state?.status === 'waiting' && !seat?.ready) {
      await act(observer, () => c.socket.emit('setReady', { ready: true }));
    }
  }

  let prevEvent: string | null = null;
  while (result.steps < opts.maxSteps) {
    const st = observer.state;
    if (!st) throw new Error('未收到房间状态');
    result.finalState = st;
    if (st.lastEvent !== prevEvent) {
      prevEvent = st.lastEvent;
      if (st.lastEvent === 'banked') result.banked += 1;
      if (st.lastEvent === 'bust') result.busts += 1;
      if (st.lastEvent === 'badge_used') result.badgeUsed += 1;
    }
    if (st.status === 'finished') {
      result.winnerId = st.winnerId;
      result.finished = true;
      return result;
    }
    const turn = st.turn;
    if (!turn) throw new Error(`回合缺失，状态 ${st.status}`);
    const actor = clientsIn.find((c) => c.userId === turn.playerId);
    if (!actor) throw new Error('当前回合玩家不在客户端集合中');

    if (opts.useBadge && turn.badgeAvailable) {
      await act(observer, () => actor.socket.emit('useBadge'));
      result.steps += 1;
      continue;
    }
    if (turn.canBank && turn.roundScore >= opts.bankAt) {
      await act(observer, () => actor.socket.emit('bankAndPass'));
      result.steps += 1;
      continue;
    }
    if (turn.canRoll && turn.selected.length > 0) {
      await act(observer, () => actor.socket.emit('rollDice'));
      result.steps += 1;
      continue;
    }
    const combos = turn.availableCombos;
    if (combos.length === 0) {
      await act(observer, () => actor.socket.emit('bankAndPass'));
      result.steps += 1;
      continue;
    }
    let combo = combos[0]!;
    if (opts.widest) {
      for (const c of combos) if (c.diceIndices.length > combo.diceIndices.length) combo = c;
    }
    await toggleAll(observer, actor, combo.diceIndices);
    result.steps += 1;
  }
  return result;
}

beforeEach(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kcd2dice-'));
  server = await startServer({ dataDir, port: 0, secret: 'test-secret-for-vitest-suite-0001' });
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.socket.disconnect();
  await server.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('REST 认证', () => {
  it('注册 / 登录 / /api/me 全链路', async () => {
    const reg = await registerUser('alice');
    expect(reg.user.username).toBe('alice');

    const login = await fetch(`${baseUrl()}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'ALICE', password: 'pw123456' }),
    });
    expect(login.status).toBe(200);
    const loginBody = (await login.json()) as { token: string };
    expect(typeof loginBody.token).toBe('string');

    const me = await fetch(`${baseUrl()}/api/me`, {
      headers: { authorization: `Bearer ${loginBody.token}` },
    });
    expect(me.status).toBe(200);
    const meBody = (await me.json()) as { user: { username: string; coins: number } };
    expect(meBody.user.username).toBe('alice');
    expect(meBody.user.coins).toBe(500);

    const unauth = await fetch(`${baseUrl()}/api/me`);
    expect(unauth.status).toBe(401);
  });

  it('重复用户名 409、弱密码 400、错误密码 401', async () => {
    await registerUser('bob');
    const dup = await fetch(`${baseUrl()}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'bob', password: 'pw123456' }),
    });
    expect(dup.status).toBe(409);

    const weak = await fetch(`${baseUrl()}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'carol', password: '123' }),
    });
    expect(weak.status).toBe(400);

    const bad = await fetch(`${baseUrl()}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'bob', password: 'wrong-pass' }),
    });
    expect(bad.status).toBe(401);
  });
});

describe('Socket 房间与对局', () => {
  it('拒绝未认证连接、错误房间号与非法下注', async () => {
    const badSocket = ioClient(baseUrl(), { transports: ['websocket'], forceNew: true });
    const authError = await new Promise<string>((resolve) => {
      badSocket.once('connect_error', (e) => resolve(e.message));
    });
    expect(authError).toBe('AUTH_INVALID');
    badSocket.disconnect();

    const a = await connectClient('dave');
    const notFound = await joinRoom(a, { roomCode: 'ZZZZZZ', diceSet: ['ordinary'], badge: null });
    expect(notFound.ok).toBe(false);
    expect(notFound.error?.code).toBe('ROOM_NOT_FOUND');

    const lowWager = await createRoom(a, {
      wager: 5,
      targetScore: 2000,
      diceSet: ['ordinary'],
      badge: null,
    });
    expect(lowWager.ok).toBe(false);
    expect(lowWager.error?.code).toBe('BAD_INPUT');

    const badDice = await createRoom(a, {
      wager: 10,
      targetScore: 2000,
      diceSet: ['no-such-die'],
      badge: null,
    });
    expect(badDice.ok).toBe(false);
    expect(badDice.error?.code).toBe('BAD_INPUT');
  });

  it('房间满员返回 ROOM_FULL', async () => {
    const a = await connectClient('eve');
    const b = await connectClient('frank');
    const c = await connectClient('grace');
    const created = await createRoom(a, {
      wager: 10,
      targetScore: 2000,
      diceSet: ['ordinary'],
      badge: null,
    });
    expect(created.ok).toBe(true);
    const code = created.data!.roomCode;
    const joined = await joinRoom(b, { roomCode: code, diceSet: ['ordinary'], badge: null });
    expect(joined.ok).toBe(true);
    expect(joined.data!.players).toHaveLength(2);
    const third = await joinRoom(c, { roomCode: code, diceSet: ['ordinary'], badge: null });
    expect(third.ok).toBe(false);
    expect(third.error?.code).toBe('ROOM_FULL');
  });

  it('空 diceSet 视为全普通骰并补齐（大厅空位文案）', async () => {
    const a = await connectClient('no_dice');
    const created = await createRoom(a, {
      wager: 10,
      targetScore: 2000,
      diceSet: [],
      badge: null,
    });
    expect(created.ok).toBe(true);
    expect(created.data!.players[0]!.diceSet).toEqual(['ordinary']);
  });

  it('完整对局：开局→掷骰→用徽章→存分→结算（含金币与胜负场次）', async () => {
    const a = await connectClient('henry');
    const b = await connectClient('hans');
    const lucky = ['lucky', 'lucky', 'lucky', 'lucky', 'lucky', 'lucky'];
    const created = await createRoom(a, {
      wager: 10,
      targetScore: 2000,
      diceSet: lucky,
      badge: 'silver-warlord',
    });
    expect(created.ok).toBe(true);
    const code = created.data!.roomCode;
    expect(created.data!.status).toBe('waiting');
    expect(created.data!.pot).toBe(20);
    expect(created.data!.players[0]!.coins).toBe(490);

    const joined = await joinRoom(b, { roomCode: code, diceSet: lucky, badge: 'silver-warlord' });
    expect(joined.ok).toBe(true);
    expect(joined.data!.badgeTierActive).toBe('silver');

    const result = await drive([a, b], { bankAt: 250, useBadge: true, widest: false, maxSteps: 500 });

    expect(result.finished).toBe(true);
    expect(result.winnerId).not.toBeNull();
    expect(result.finalState.status).toBe('finished');
    expect(result.finalState.lastEvent).toBe('game_over');
    expect(result.banked).toBeGreaterThan(0);
    expect(result.badgeUsed).toBeGreaterThan(0);

    const winner = result.finalState.players.find((p) => p.id === result.winnerId)!;
    const loser = result.finalState.players.find((p) => p.id !== result.winnerId)!;
    expect(winner.score).toBeGreaterThanOrEqual(2000);
    expect(loser.score).toBeLessThan(2000);

    expect(server.store.findById(winner.id)!.coins).toBe(510);
    expect(server.store.findById(winner.id)!.wins).toBe(1);
    expect(server.store.findById(loser.id)!.coins).toBe(490);
    expect(server.store.findById(loser.id)!.losses).toBe(1);
  });

  it('爆掉归零并轮转：使用不幸骰可观测到 bust 事件', async () => {
    const a = await connectClient('kuno');
    const b = await connectClient('klaus');
    const misfortune = Array<string>(6).fill('misfortune');
    const created = await createRoom(a, {
      wager: 10,
      targetScore: 6000,
      diceSet: misfortune,
      badge: null,
    });
    expect(created.ok).toBe(true);
    const joined = await joinRoom(b, {
      roomCode: created.data!.roomCode,
      diceSet: misfortune,
      badge: null,
    });
    expect(joined.ok).toBe(true);

    const result = await drive([a, b], { bankAt: 999_999, useBadge: false, widest: true, maxSteps: 200 });
    expect(result.busts).toBeGreaterThan(0);
    expect(result.finished).toBe(false);
    expect(result.finalState.players.every((p) => p.score === 0)).toBe(true);
    expect([a, b].some((c) => c.events.includes('bust'))).toBe(true);
  });

  it('等待中离场会退还下注并解散房间', async () => {
    const a = await connectClient('lena');
    const created = await createRoom(a, {
      wager: 10,
      targetScore: 2000,
      diceSet: ['ordinary'],
      badge: null,
    });
    expect(created.ok).toBe(true);
    const code = created.data!.roomCode;
    a.socket.emit('leaveRoom');
    await new Promise((r) => setTimeout(r, 300));
    expect(server.store.findById(a.userId)!.coins).toBe(500);
    const rejoin = await joinRoom(a, { roomCode: code, diceSet: ['ordinary'], badge: null });
    expect(rejoin.ok).toBe(false);
    expect(rejoin.error?.code).toBe('ROOM_NOT_FOUND');
  });

  it('等待中房主离场：双方都退还下注且房间不可再加入', async () => {
    const a = await connectClient('marta');
    const b = await connectClient('martin');
    const created = await createRoom(a, {
      wager: 10,
      targetScore: 2000,
      diceSet: ['ordinary'],
      badge: null,
    });
    expect(created.ok).toBe(true);
    const code = created.data!.roomCode;
    const joined = await joinRoom(b, { roomCode: code, diceSet: ['ordinary'], badge: null });
    expect(joined.ok).toBe(true);
    expect(server.store.findById(a.userId)!.coins).toBe(490);
    expect(server.store.findById(b.userId)!.coins).toBe(490);

    a.socket.emit('leaveRoom');
    await sleep(300);

    expect(server.store.findById(a.userId)!.coins).toBe(500);
    expect(server.store.findById(b.userId)!.coins).toBe(500);
    expect(b.errors.some((e) => e.code === 'ROOM_NOT_FOUND')).toBe(true);

    const rejoinB = await joinRoom(b, { roomCode: code, diceSet: ['ordinary'], badge: null });
    expect(rejoinB.ok).toBe(false);
    expect(rejoinB.error?.code).toBe('ROOM_NOT_FOUND');
    const rejoinA = await joinRoom(a, { roomCode: code, diceSet: ['ordinary'], badge: null });
    expect(rejoinA.ok).toBe(false);
    expect(rejoinA.error?.code).toBe('ROOM_NOT_FOUND');
  });

  it('等待中客人离场：双方都退还下注且房间不可再加入', async () => {
    const a = await connectClient('nick');
    const b = await connectClient('nina');
    const created = await createRoom(a, {
      wager: 10,
      targetScore: 2000,
      diceSet: ['ordinary'],
      badge: null,
    });
    expect(created.ok).toBe(true);
    const code = created.data!.roomCode;
    const joined = await joinRoom(b, { roomCode: code, diceSet: ['ordinary'], badge: null });
    expect(joined.ok).toBe(true);

    b.socket.emit('leaveRoom');
    await sleep(300);

    expect(server.store.findById(a.userId)!.coins).toBe(500);
    expect(server.store.findById(b.userId)!.coins).toBe(500);
    expect(a.errors.some((e) => e.code === 'ROOM_NOT_FOUND')).toBe(true);

    const rejoin = await joinRoom(a, { roomCode: code, diceSet: ['ordinary'], badge: null });
    expect(rejoin.ok).toBe(false);
    expect(rejoin.error?.code).toBe('ROOM_NOT_FOUND');
  });

  it('复活徽章只重掷骰池中剩余的骰子，不会把骰池补满', async () => {
    const a = await connectClient('olga');
    const b = await connectClient('otto');
    const misfortune = Array<string>(6).fill('misfortune');
    const created = await createRoom(a, {
      wager: 10,
      targetScore: 2000,
      diceSet: misfortune,
      badge: 'tin-resurrection',
    });
    expect(created.ok).toBe(true);
    const joined = await joinRoom(b, {
      roomCode: created.data!.roomCode,
      diceSet: misfortune,
      badge: 'tin-resurrection',
    });
    expect(joined.ok).toBe(true);
    expect(joined.data!.badgeTierActive).toBe('tin');

    // 开局：不幸骰全掷出 1，可计分且不爆
    await act(a, () => a.socket.emit('setReady', { ready: true }));
    const started = await actWithRandom(a, rollOnes, () => b.socket.emit('setReady', { ready: true }));
    expect(started.status).toBe('playing');
    expect(started.turn!.playerId).toBe(a.userId);
    expect(started.turn!.dicePool).toHaveLength(6);
    expect(started.turn!.availableCombos.length).toBeGreaterThan(0);

    // 只勾 3 颗 1（三同点 1000），留 3 颗待掷
    await toggleAll(a, a, [0, 1, 2]);
    const rolled = await actWithRandom(a, bustRoll(), () => a.socket.emit('rollDice'));
    expect(rolled.turn!.roundScore).toBe(1000);
    expect(rolled.turn!.dicePool).toHaveLength(3);
    expect(rolled.turn!.badgeAvailable).toBe(true);
    expect(rolled.turn!.badgeUseHint).toContain('复活');

    const revived = await actWithRandom(a, rollOnes, () => a.socket.emit('useBadge'));
    expect(revived.turn!.dicePool).toHaveLength(3);
    expect(revived.turn!.roundScore).toBe(1000);
    expect(revived.turn!.badgeAvailable).toBe(false);
  });
});
