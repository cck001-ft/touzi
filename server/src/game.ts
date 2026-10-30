import { randomInt } from 'node:crypto';
import type { Server as IOServer, Socket } from 'socket.io';
import type {
  Ack,
  BadgeSpec,
  ClientToServerEvents,
  DieFace,
  DieSpec,
  PlayerState,
  RoomState,
  RoomStatus,
  ServerToClientEvents,
  TurnState,
} from '@kcd2dice/shared';
import { BADGE_CATALOG, DICE_CATALOG, getBadgeSpec, getDieSpec, rules } from '@kcd2dice/shared';
import {
  MAX_DICE_IN_SET,
  MIN_WAGER,
  RECONNECT_GRACE_MS,
  REQUIRE_BADGE_TIER_MATCH,
  ROOM_CODE_LENGTH,
  TARGET_SCORES,
  TURN_MS,
} from './config';
import { verifyToken } from './auth';
import type { UserRecord, UserStore } from './store';

type IO = IOServer<ClientToServerEvents, ServerToClientEvents>;
type Sock = Socket<ClientToServerEvents, ServerToClientEvents>;

/** 服务端内部玩家模型：比 PlayerState 多出骰子规格、连接信息等运行期字段 */
interface PlayerInternal extends PlayerState {
  socketId: string | null;
  diceSpecs: DieSpec[];
  badgeSpec: BadgeSpec | null;
}

interface TurnInternal {
  playerId: string;
  dicePool: DieFace[];
  selected: number[];
  roundScore: number;
  canRoll: boolean;
  canBank: boolean;
  /** 已爆掉、正等待复活徽章裁决 */
  bustPending: boolean;
  /** 本回合已激活的军阀倍率（未使用为 1） */
  warlordMultiplier: number;
  deadline: number | null;
}

interface Room {
  code: string;
  status: RoomStatus;
  targetScore: number;
  wager: number;
  players: PlayerInternal[];
  currentPlayerIndex: number;
  turn: TurnInternal | null;
  winnerId: string | null;
  lastEvent: string | null;
  turnTimer: NodeJS.Timeout | null;
  graceTimers: Map<string, NodeJS.Timeout>;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}

function ok<T>(data: T): Ack<T> {
  return { ok: true, data };
}

function err(code: string, message: string): Ack<never> {
  return { ok: false, error: { code, message } };
}

function randomRoomCode(taken: Set<string>): string {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
      code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    }
    if (!taken.has(code)) return code;
  }
  throw new Error('无法生成唯一房间号');
}

/** 校验并展开骰子配置；空数组=全普通骰（与大厅"空位补齐"文案一致） */
function resolveDiceSet(raw: unknown): DieSpec[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_DICE_IN_SET) return null;
  const specs: DieSpec[] = [];
  for (const id of raw) {
    if (typeof id !== 'string') return null;
    const spec = getDieSpec(id);
    if (!spec) return null;
    specs.push(spec);
  }
  if (specs.length === 0) specs.push(getDieSpec('ordinary')!);
  return specs;
}

function resolveBadge(raw: unknown): BadgeSpec | null | undefined {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') return undefined;
  return getBadgeSpec(raw) ?? undefined;
}

export class GameHub {
  private readonly io: IO;
  private readonly store: UserStore;
  private readonly secret: string;
  private readonly rooms = new Map<string, Room>();
  /** userId -> roomCode */
  private readonly membership = new Map<string, string>();
  /** socketId -> userId */
  private readonly socketUsers = new Map<string, string>();

  constructor(io: IO, store: UserStore, secret: string) {
    this.io = io;
    this.store = store;
    this.secret = secret;
    io.use((socket, next) => {
      const user = this.resolveHandshakeUser(socket);
      if (!user) {
        next(new Error('AUTH_INVALID'));
        return;
      }
      this.socketUsers.set(socket.id, user.id);
      socket.data.userId = user.id;
      next();
    });
    io.on('connection', (socket) => this.onConnection(socket));
  }

  dispose(): void {
    for (const room of this.rooms.values()) {
      this.clearTurnTimer(room);
      for (const t of room.graceTimers.values()) clearTimeout(t);
      room.graceTimers.clear();
    }
    this.rooms.clear();
    this.membership.clear();
    this.socketUsers.clear();
  }

  // ---------------------------------------------------------------- 认证 / 连接

  private resolveHandshakeUser(socket: Sock): UserRecord | null {
    const raw: unknown = (socket.handshake.auth as Record<string, unknown> | undefined)?.token;
    if (typeof raw !== 'string' || raw.length === 0) return null;
    const userId = verifyToken(this.secret, raw);
    if (!userId) return null;
    return this.store.findById(userId) ?? null;
  }

  private onConnection(socket: Sock): void {
    const userId = socket.data.userId as string;
    const room = this.reconnect(socket, userId);

    socket.on('createRoom', (payload, ack) => this.guard(socket, ack, () => this.createRoom(socket, payload, ack)));
    socket.on('joinRoom', (payload, ack) => this.guard(socket, ack, () => this.joinRoom(socket, payload, ack)));
    socket.on('leaveRoom', () => this.guard(socket, null, () => this.leaveRoom(socket)));
    socket.on('setReady', (payload) => this.guard(socket, null, () => this.setReady(socket, payload)));
    socket.on('toggleSelect', (payload) => this.guard(socket, null, () => this.toggleSelect(socket, payload)));
    socket.on('rollDice', () => this.guard(socket, null, () => this.rollDice(socket)));
    socket.on('bankAndPass', () => this.guard(socket, null, () => this.bankAndPass(socket)));
    socket.on('useBadge', () => this.guard(socket, null, () => this.useBadge(socket)));
    socket.on('forfeit', () => this.guard(socket, null, () => this.forfeit(socket)));
    socket.on('disconnect', () => this.onDisconnect(socket));

    if (room) socket.emit('roomUpdate', this.toState(room));
  }

  /** 统一错误兜底：任何未捕获异常都转成 error 事件，绝不炸掉 socket */
  private guard(socket: Sock, ack: ((r: Ack<RoomState>) => void) | null, fn: () => void): void {
    try {
      fn();
    } catch (e) {
      if (e instanceof GameError) {
        socket.emit('error', { code: e.code, message: e.message });
        if (typeof ack === 'function') ack(err(e.code, e.message));
        return;
      }
      const message = e instanceof Error ? e.message : '服务端内部错误';
      socket.emit('error', { code: 'BAD_STATE', message });
      if (typeof ack === 'function') ack(err('BAD_STATE', message));
    }
  }

  private onDisconnect(socket: Sock): void {
    const userId = this.socketUsers.get(socket.id) ?? (socket.data.userId as string | undefined);
    this.socketUsers.delete(socket.id);
    if (!userId) return;
    const room = this.roomOfUser(userId);
    if (!room) return;
    const player = room.players.find((p) => p.id === userId);
    if (!player || player.socketId !== socket.id) return;
    player.socketId = null;
    player.connected = false;
    if (room.status === 'playing') {
      const timer = setTimeout(() => this.expireConnection(room.code, userId), RECONNECT_GRACE_MS);
      timer.unref?.();
      room.graceTimers.set(userId, timer);
    }
    this.emitState(room);
  }

  private expireConnection(roomCode: string, userId: string): void {
    const room = this.rooms.get(roomCode);
    if (!room) return;
    room.graceTimers.delete(userId);
    const player = room.players.find((p) => p.id === userId);
    if (!player || player.connected) return;
    this.forfeitPlayer(room, player.id);
  }

  private reconnect(socket: Sock, userId: string): Room | null {
    const room = this.roomOfUser(userId);
    if (!room) return null;
    const player = room.players.find((p) => p.id === userId);
    if (!player) return null;
    const timer = room.graceTimers.get(userId);
    if (timer) {
      clearTimeout(timer);
      room.graceTimers.delete(userId);
    }
    player.socketId = socket.id;
    player.connected = true;
    room.lastEvent = 'player_reconnected';
    socket.join(room.code);
    this.emitState(room);
    return room;
  }

  // ---------------------------------------------------------------- 房间生命周期

  private createRoom(socket: Sock, payload: unknown, ack: unknown): void {
    const reply = typeof ack === 'function' ? (ack as (r: Ack<RoomState>) => void) : null;
    const userId = this.requireUserId(socket);
    if (this.roomOfUser(userId)) {
      this.replyFail(socket, reply, 'BAD_STATE', '你已在房间中');
      return;
    }
    if (!isPlainObject(payload)) {
      this.replyFail(socket, reply, 'BAD_INPUT', 'payload 必须是对象');
      return;
    }
    const wager = payload.wager;
    const targetScore = payload.targetScore;
    if (!isInt(wager) || wager < MIN_WAGER) {
      this.replyFail(socket, reply, 'BAD_INPUT', `下注必须是 >= ${MIN_WAGER} 的整数`);
      return;
    }
    if (!isInt(targetScore) || !TARGET_SCORES.includes(targetScore)) {
      this.replyFail(socket, reply, 'BAD_INPUT', `目标分数只能是 ${TARGET_SCORES.join(' / ')}`);
      return;
    }
    const diceSpecs = resolveDiceSet(payload.diceSet);
    if (!diceSpecs) {
      this.replyFail(socket, reply, 'BAD_INPUT', `diceSet 需为 0-${MAX_DICE_IN_SET} 个合法骰子 id（空=全普通）`);
      return;
    }
    const badgeSpec = resolveBadge(payload.badge);
    if (badgeSpec === undefined) {
      this.replyFail(socket, reply, 'BAD_INPUT', 'badge 必须是合法徽章 id 或 null');
      return;
    }
    const user = this.requireUser(userId);
    if (user.coins < wager) {
      this.replyFail(socket, reply, 'INSUFFICIENT_COINS', '金币不足以下注');
      return;
    }

    const taken = new Set(this.rooms.keys());
    const code = randomRoomCode(taken);
    const coinsAfterWager = user.coins - wager;
    this.store.setCoins(user.id, coinsAfterWager);

    const room: Room = {
      code,
      status: 'waiting',
      targetScore,
      wager,
      players: [this.makePlayer(user, coinsAfterWager, diceSpecs, badgeSpec, true, socket.id)],
      currentPlayerIndex: 0,
      turn: null,
      winnerId: null,
      lastEvent: null,
      turnTimer: null,
      graceTimers: new Map(),
    };
    this.rooms.set(code, room);
    this.membership.set(user.id, code);
    socket.join(code);
    this.emitState(room);
    if (reply) reply(ok(this.toState(room)));
  }

  private joinRoom(socket: Sock, payload: unknown, ack: unknown): void {
    const reply = typeof ack === 'function' ? (ack as (r: Ack<RoomState>) => void) : null;
    const userId = this.requireUserId(socket);
    if (this.roomOfUser(userId)) {
      this.replyFail(socket, reply, 'BAD_STATE', '你已在房间中');
      return;
    }
    if (!isPlainObject(payload)) {
      this.replyFail(socket, reply, 'BAD_INPUT', 'payload 必须是对象');
      return;
    }
    const rawCode = payload.roomCode;
    if (typeof rawCode !== 'string' || rawCode.trim().length === 0) {
      this.replyFail(socket, reply, 'BAD_INPUT', 'roomCode 必填');
      return;
    }
    const room = this.rooms.get(rawCode.trim().toUpperCase());
    if (!room) {
      this.replyFail(socket, reply, 'ROOM_NOT_FOUND', '房间不存在');
      return;
    }
    if (room.players.length >= 2) {
      this.replyFail(socket, reply, 'ROOM_FULL', '房间已满');
      return;
    }
    if (room.status !== 'waiting') {
      this.replyFail(socket, reply, 'BAD_STATE', '对局已开始，无法加入');
      return;
    }
    const diceSpecs = resolveDiceSet(payload.diceSet);
    if (!diceSpecs) {
      this.replyFail(socket, reply, 'BAD_INPUT', `diceSet 需为 0-${MAX_DICE_IN_SET} 个合法骰子 id（空=全普通）`);
      return;
    }
    const badgeSpec = resolveBadge(payload.badge);
    if (badgeSpec === undefined) {
      this.replyFail(socket, reply, 'BAD_INPUT', 'badge 必须是合法徽章 id 或 null');
      return;
    }
    const user = this.requireUser(userId);
    if (user.coins < room.wager) {
      this.replyFail(socket, reply, 'INSUFFICIENT_COINS', '金币不足以下注');
      return;
    }

    const coinsAfterWager = user.coins - room.wager;
    this.store.setCoins(user.id, coinsAfterWager);
    room.players.push(this.makePlayer(user, coinsAfterWager, diceSpecs, badgeSpec, false, socket.id));
    this.membership.set(user.id, room.code);
    socket.join(room.code);
    this.emitState(room);
    if (reply) reply(ok(this.toState(room)));
  }

  private setReady(socket: Sock, payload: unknown): void {
    const { room, player } = this.requireSeat(socket);
    if (room.status !== 'waiting') throw new GameError('BAD_STATE', '对局已开始');
    if (!isPlainObject(payload) || typeof payload.ready !== 'boolean') {
      throw new GameError('BAD_INPUT', 'ready 必须是布尔值');
    }
    player.ready = payload.ready;
    if (room.players.length === 2 && room.players.every((p) => p.ready)) this.startGame(room);
    else this.emitState(room);
  }

  private startGame(room: Room): void {
    room.status = 'playing';
    room.currentPlayerIndex = 0;
    room.winnerId = null;
    room.lastEvent = 'game_started';
    for (const p of room.players) {
      p.score = 0;
      p.badgeUsesLeft = p.badgeSpec ? p.badgeSpec.usesPerGame : 0;
    }
    this.beginTurn(room, 0);
  }

  private leaveRoom(socket: Sock): void {
    const userId = this.requireUserId(socket);
    const room = this.roomOfUser(userId);
    if (!room) throw new GameError('BAD_STATE', '你不在任何房间中');
    if (room.status === 'playing') {
      this.forfeitPlayer(room, userId);
      return;
    }
    // 等待中解散房间：房间内所有玩家（含离场者）都要退还下注
    for (const p of room.players) this.refund(room, p);
    room.lastEvent = 'player_left';
    this.destroyRoom(room, socket.id);
  }

  private destroyRoom(room: Room, exceptSocketId: string | null): void {
    this.clearTurnTimer(room);
    for (const t of room.graceTimers.values()) clearTimeout(t);
    room.graceTimers.clear();
    for (const p of room.players) {
      this.membership.delete(p.id);
      if (p.socketId && p.socketId !== exceptSocketId) {
        const peer = this.io.sockets.sockets.get(p.socketId);
        if (peer) {
          peer.leave(room.code);
          peer.emit('error', { code: 'ROOM_NOT_FOUND', message: '房间已解散' });
        }
      }
    }
    this.rooms.delete(room.code);
  }

  private forfeit(socket: Sock): void {
    const userId = this.requireUserId(socket);
    const room = this.roomOfUser(userId);
    if (!room) throw new GameError('BAD_STATE', '你不在任何房间中');
    if (room.status === 'playing') {
      this.forfeitPlayer(room, userId);
      return;
    }
    this.leaveRoom(socket);
  }

  // ---------------------------------------------------------------- 回合动作

  private toggleSelect(socket: Sock, payload: unknown): void {
    const { room, player, turn } = this.requireActiveTurn(socket);
    if (!isPlainObject(payload) || !isInt(payload.index)) {
      throw new GameError('BAD_INPUT', 'index 必须是整数');
    }
    const index = payload.index;
    if (index < 0 || index >= turn.dicePool.length) throw new GameError('BAD_INPUT', 'index 超出骰池范围');
    if (turn.bustPending) throw new GameError('BAD_STATE', '已爆掉，请使用复活徽章或结束回合');
    const at = turn.selected.indexOf(index);
    if (at >= 0) turn.selected.splice(at, 1);
    else turn.selected.push(index);
    turn.selected.sort((a, b) => a - b);
    this.refreshTurnFlags(room, player, turn);
    this.emitState(room);
  }

  private rollDice(socket: Sock): void {
    const { room, player, turn } = this.requireActiveTurn(socket);
    if (turn.bustPending) throw new GameError('BAD_STATE', '已爆掉，请使用复活徽章或结束回合');
    if (turn.selected.length === 0) throw new GameError('INVALID_MOVE', '请先选择要计分的骰子');
    const picked = turn.selected.map((i) => turn.dicePool[i]);
    const scored = rules.scoreSelected(picked);
    if (!scored.valid) throw new GameError('INVALID_MOVE', '所选骰子不构成合法组合');

    turn.roundScore += scored.score;
    const kept = turn.dicePool.filter((_face, i) => !turn.selected.includes(i));
    const specs = player.diceSpecs;
    turn.dicePool = rules.rollDicePool(specs, kept.length === 0 ? MAX_DICE_IN_SET : kept.length);
    turn.selected = [];
    room.lastEvent = kept.length === 0 ? 'hot_dice' : 'rolled';

    if (rules.isBust(turn.dicePool)) {
      if (this.canUseResurrection(room, player)) {
        turn.bustPending = true;
        turn.canRoll = false;
        turn.canBank = false;
        turn.deadline = Date.now() + TURN_MS;
        this.emitState(room);
        return;
      }
      this.endTurn(room, 'bust', false);
      return;
    }
    this.refreshTurnFlags(room, player, turn);
    turn.deadline = Date.now() + TURN_MS;
    this.emitState(room);
  }

  private bankAndPass(socket: Sock): void {
    const { room, player, turn } = this.requireActiveTurn(socket);
    if (turn.bustPending) {
      this.endTurn(room, 'bust', false);
      return;
    }
    if (turn.roundScore <= 0) throw new GameError('INVALID_MOVE', '本回合尚无得分可存');
    this.bank(room, player, turn, 'banked');
  }

  private useBadge(socket: Sock): void {
    const { room, player, turn } = this.requireActiveTurn(socket);
    const spec = player.badgeSpec;
    if (!spec) throw new GameError('BAD_STATE', '未装备徽章');
    if (player.badgeUsesLeft <= 0) throw new GameError('BAD_STATE', '本局徽章次数已用完');
    if (!this.tierGateOpen(room, player)) throw new GameError('BAD_STATE', '徽章需双方同等级才生效');

    if (spec.effect === 'resurrection') {
      if (!turn.bustPending) throw new GameError('BAD_STATE', '只有爆掉时才能使用复活徽章');
      player.badgeUsesLeft -= 1;
      turn.bustPending = false;
      // 复活 = 重掷同一批骰子（爆掉时池里剩几颗就重掷几颗），仍可能再次爆掉
      turn.dicePool = rules.rollDicePool(player.diceSpecs, turn.dicePool.length);
      turn.selected = [];
      room.lastEvent = 'badge_used';
      if (rules.isBust(turn.dicePool)) {
        this.endTurn(room, 'bust', false);
        return;
      }
      turn.deadline = Date.now() + TURN_MS;
      this.refreshTurnFlags(room, player, turn);
      this.emitState(room);
      return;
    }

    if (turn.roundScore <= 0) throw new GameError('BAD_STATE', '本回合尚无得分，军阀徽章无效');
    if (turn.warlordMultiplier !== 1) throw new GameError('BAD_STATE', '本回合已使用过军阀徽章');
    player.badgeUsesLeft -= 1;
    turn.warlordMultiplier = spec.multiplier;
    turn.deadline = Date.now() + TURN_MS;
    room.lastEvent = 'badge_used';
    this.refreshTurnFlags(room, player, turn);
    this.emitState(room);
  }

  // ---------------------------------------------------------------- 回合推进

  private beginTurn(room: Room, index: number): void {
    const player = room.players[index];
    if (!player) throw new GameError('BAD_STATE', '玩家不存在');
    room.currentPlayerIndex = index;
    room.turn = {
      playerId: player.id,
      dicePool: rules.rollDicePool(player.diceSpecs, MAX_DICE_IN_SET),
      selected: [],
      roundScore: 0,
      canRoll: false,
      canBank: false,
      bustPending: false,
      warlordMultiplier: 1,
      deadline: Date.now() + TURN_MS,
    };
    this.scheduleTurnTimer(room);
    // 开局直接掷一次，开局即爆掉则本回合归零并轮到下家
    if (rules.isBust(room.turn.dicePool)) {
      this.endTurn(room, 'bust', false);
      return;
    }
    this.emitState(room);
  }

  private endTurn(room: Room, lastEvent: string, keepScore: boolean): void {
    const turn = room.turn;
    if (turn && !keepScore) turn.roundScore = 0;
    this.clearTurnTimer(room);
    room.turn = null;
    room.lastEvent = lastEvent;
    if (room.players.length < 2) {
      this.emitState(room);
      return;
    }
    const next = (room.currentPlayerIndex + 1) % room.players.length;
    this.beginTurn(room, next);
  }

  private bank(room: Room, player: PlayerInternal, turn: TurnInternal, lastEvent: string): void {
    const gained = Math.round(turn.roundScore * turn.warlordMultiplier);
    player.score += gained;
    room.lastEvent = lastEvent;
    if (player.score >= room.targetScore) {
      this.gameOver(room, player.id);
      return;
    }
    this.endTurn(room, lastEvent, false);
  }

  private gameOver(room: Room, winnerId: string): void {
    this.clearTurnTimer(room);
    for (const t of room.graceTimers.values()) clearTimeout(t);
    room.graceTimers.clear();
    room.status = 'finished';
    room.winnerId = winnerId;
    room.turn = null;
    room.lastEvent = 'game_over';
    const winner = room.players.find((p) => p.id === winnerId);
    const loser = room.players.find((p) => p.id !== winnerId);
    if (winner) {
      const user = this.requireUser(winner.id);
      const coins = user.coins + room.wager * 2;
      this.store.setCoins(user.id, coins);
      this.store.recordResult(user.id, true);
      winner.coins = coins;
    }
    if (loser) {
      const user = this.requireUser(loser.id);
      this.store.recordResult(user.id, false);
      loser.coins = user.coins;
    }
    this.emitState(room);
  }

  private forfeitPlayer(room: Room, userId: string): void {
    const other = room.players.find((p) => p.id !== userId);
    if (room.status === 'playing' && other) {
      room.lastEvent = 'player_left';
      this.gameOver(room, other.id);
      return;
    }
    const leaver = room.players.find((p) => p.id === userId);
    if (leaver) this.refund(room, leaver);
    room.lastEvent = 'player_left';
    this.destroyRoom(room, null);
  }

  private refund(room: Room, player: PlayerInternal): void {
    const user = this.store.findById(player.id);
    if (!user) return;
    this.store.setCoins(user.id, user.coins + room.wager);
    player.coins = user.coins + room.wager;
  }

  // ---------------------------------------------------------------- 定时器

  private scheduleTurnTimer(room: Room): void {
    this.clearTurnTimer(room);
    const timer = setTimeout(() => this.onTurnTimeout(room.code), TURN_MS);
    timer.unref?.();
    room.turnTimer = timer;
  }

  private clearTurnTimer(room: Room): void {
    if (room.turnTimer) {
      clearTimeout(room.turnTimer);
      room.turnTimer = null;
    }
  }

  private onTurnTimeout(roomCode: string): void {
    const room = this.rooms.get(roomCode);
    if (!room || room.status !== 'playing' || !room.turn) return;
    const turn = room.turn;
    const player = room.players.find((p) => p.id === turn.playerId);
    this.clearTurnTimer(room);
    room.lastEvent = 'turn_timeout';
    if (!player || turn.bustPending || turn.roundScore <= 0) {
      this.endTurn(room, 'turn_timeout', false);
      return;
    }
    const gained = Math.round(turn.roundScore * turn.warlordMultiplier);
    player.score += gained;
    if (player.score >= room.targetScore) {
      this.gameOver(room, player.id);
      return;
    }
    this.endTurn(room, 'turn_timeout', false);
  }

  // ---------------------------------------------------------------- 规则辅助

  private tierGateOpen(room: Room, player: PlayerInternal): boolean {
    if (!REQUIRE_BADGE_TIER_MATCH) return true;
    const spec = player.badgeSpec;
    if (!spec) return false;
    return this.badgeTierActive(room) === spec.tier;
  }

  private canUseResurrection(room: Room, player: PlayerInternal): boolean {
    const spec = player.badgeSpec;
    return (
      !!spec && spec.effect === 'resurrection' && player.badgeUsesLeft > 0 && this.tierGateOpen(room, player)
    );
  }

  private badgeTierActive(room: Room): RoomState['badgeTierActive'] {
    if (room.players.length !== 2) return null;
    const tiers = room.players.map((p) => p.badgeSpec?.tier ?? null);
    if (tiers[0] === null || tiers[1] === null) return null;
    return tiers[0] === tiers[1] ? (tiers[0] as RoomState['badgeTierActive']) : null;
  }

  private badgeHint(room: Room, player: PlayerInternal, turn: TurnInternal): string | null {
    const spec = player.badgeSpec;
    if (!spec || player.badgeUsesLeft <= 0) return null;
    if (!this.tierGateOpen(room, player)) return null;
    if (spec.effect === 'resurrection') {
      return turn.bustPending ? '复活徽章可用：保留本回合已得分数' : null;
    }
    if (turn.roundScore <= 0 || turn.warlordMultiplier !== 1) return null;
    return `${spec.name} 可用：本回合得分 ×${spec.multiplier}`;
  }

  private refreshTurnFlags(room: Room, player: PlayerInternal, turn: TurnInternal): void {
    const picked = turn.selected.map((i) => turn.dicePool[i]);
    turn.canRoll = !turn.bustPending && turn.selected.length > 0 && rules.scoreSelected(picked).valid;
    turn.canBank = !turn.bustPending && turn.roundScore > 0;
  }

  // ---------------------------------------------------------------- 状态投影

  private toState(room: Room): RoomState {
    const players: PlayerState[] = room.players.map((p) => ({
      id: p.id,
      username: p.username,
      coins: p.coins,
      score: p.score,
      diceSet: [...p.diceSet],
      badge: p.badge,
      badgeUsesLeft: p.badgeUsesLeft,
      connected: p.connected,
      ready: p.ready,
      isHost: p.isHost,
    }));
    const turn = room.turn;
    let turnState: TurnState | null = null;
    if (turn) {
      const owner = room.players.find((p) => p.id === turn.playerId);
      const hint = owner ? this.badgeHint(room, owner, turn) : null;
      turnState = {
        playerId: turn.playerId,
        dicePool: [...turn.dicePool],
        selected: [...turn.selected],
        availableCombos: rules.computeCombos(turn.dicePool),
        roundScore: turn.roundScore,
        canRoll: turn.canRoll,
        canBank: turn.canBank,
        badgeAvailable: hint !== null,
        badgeUseHint: hint,
        deadline: turn.deadline,
      };
    }
    return {
      roomCode: room.code,
      status: room.status,
      targetScore: room.targetScore,
      wager: room.wager,
      pot: room.wager * 2,
      badgeTierActive: this.badgeTierActive(room),
      players,
      currentPlayerIndex: room.currentPlayerIndex,
      turn: turnState,
      winnerId: room.winnerId,
      lastEvent: room.lastEvent,
    };
  }

  private emitState(room: Room): void {
    this.io.to(room.code).emit('roomUpdate', this.toState(room));
  }

  // ---------------------------------------------------------------- 上下文获取

  private requireUserId(socket: Sock): string {
    const userId = (socket.data.userId as string | undefined) ?? this.socketUsers.get(socket.id);
    if (!userId) throw new GameError('AUTH_INVALID', '未认证的 socket');
    return userId;
  }

  private requireUser(userId: string): UserRecord {
    const user = this.store.findById(userId);
    if (!user) throw new GameError('AUTH_INVALID', '用户不存在');
    return user;
  }

  private roomOfUser(userId: string): Room | null {
    const code = this.membership.get(userId);
    if (!code) return null;
    return this.rooms.get(code) ?? null;
  }

  private requireSeat(socket: Sock): { room: Room; player: PlayerInternal } {
    const userId = this.requireUserId(socket);
    const room = this.roomOfUser(userId);
    if (!room) throw new GameError('BAD_STATE', '你不在任何房间中');
    const player = room.players.find((p) => p.id === userId);
    if (!player) throw new GameError('BAD_STATE', '你不在该房间中');
    return { room, player };
  }

  private requireActiveTurn(socket: Sock): { room: Room; player: PlayerInternal; turn: TurnInternal } {
    const { room, player } = this.requireSeat(socket);
    if (room.status !== 'playing') throw new GameError('BAD_STATE', '对局未进行中');
    const turn = room.turn;
    if (!turn) throw new GameError('BAD_STATE', '当前没有进行中的回合');
    if (turn.playerId !== player.id) throw new GameError('NOT_YOUR_TURN', '还没轮到你');
    return { room, player, turn };
  }

  private replyFail(socket: Sock, reply: ((r: Ack<RoomState>) => void) | null, code: string, message: string): void {
    socket.emit('error', { code, message });
    if (reply) reply(err(code, message));
  }

  private makePlayer(
    user: UserRecord,
    coinsAfterWager: number,
    diceSpecs: DieSpec[],
    badgeSpec: BadgeSpec | null,
    isHost: boolean,
    socketId: string,
  ): PlayerInternal {
    return {
      id: user.id,
      username: user.username,
      coins: coinsAfterWager,
      score: 0,
      diceSet: diceSpecs.map((d) => d.id),
      badge: badgeSpec ? badgeSpec.id : null,
      badgeUsesLeft: badgeSpec ? badgeSpec.usesPerGame : 0,
      connected: true,
      ready: false,
      isHost,
      socketId,
      diceSpecs,
      badgeSpec,
    };
  }
}

export class GameError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export const CATALOG = { dice: DICE_CATALOG, badges: BADGE_CATALOG };
