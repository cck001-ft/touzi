/**
 * kcd2-dice 共享契约（冻结版 v1）
 * 后端/前端/规则引擎都必须且只能依赖本文件中的类型。
 * 规则引擎实现（shared/src/rules/*）必须原样导出：
 *   - const rules: RulesApi
 *   - const DICE_CATALOG: DieSpec[]
 *   - const BADGE_CATALOG: BadgeSpec[]
 *   - function getDieSpec(id: string): DieSpec | undefined
 *   - function getBadgeSpec(id: string): BadgeSpec | undefined
 */

// ============ 基础类型 ============

/** 骰面：1-6，或 devil（恶魔之首万能面） */
export type DieFace = 1 | 2 | 3 | 4 | 5 | 6 | 'devil';

/** 特殊骰子定义 */
export interface DieSpec {
  id: string;            // 'ordinary' | 'devils-head' | 'lucky' | ...
  name: string;          // 中文名
  desc: string;          // 一句话说明
  probs: number[];       // 长度 6，依次为面 1..6 的概率（0-1），实现时需归一化
  devilOnOne?: boolean;  // true = 掷出 1 时记作 'devil' 面（恶魔之首）
}

/** 徽章定义 */
export interface BadgeSpec {
  id: string;
  tier: 'tin' | 'silver' | 'gold';
  name: string;
  desc: string;
  effect: 'resurrection' | 'warlord';
  usesPerGame: number;  // 每局可用次数
  multiplier: number;   // warlord 倍率（1.25 / 1.5 / 2）；resurrection 恒为 1
}

// ============ 规则引擎 API ============

export interface Combo {
  kind: 'single1' | 'single5' | 'nOfAKind' | 'straight15' | 'straight26' | 'straight16';
  score: number;
  diceIndices: number[]; // 指向传入数组中被计分的骰子位置
}

export interface ScoredResult {
  valid: boolean;        // 所选骰子能否全部被合法计分
  score: number;         // 计分总和
  combos: Combo[];       // 分解出的组合
}

export interface RulesApi {
  /** 校验并计算所选骰子的得分；任何一颗无法计分 => valid=false */
  scoreSelected(dice: DieFace[]): ScoredResult;
  /** 当前骰池所有"可选"的计分组合（供 UI 提示） */
  computeCombos(dice: DieFace[]): Combo[];
  /** 是否爆掉（无任何可选组合） */
  isBust(dice: DieFace[]): boolean;
  /** 按骰子规格加权掷 count 颗；specs 不足时用普通骰补齐 */
  rollDicePool(specs: DieSpec[], count: number): DieFace[];
}

// ============ 玩家 / 房间 / 对局状态 ============

export interface UserPublic {
  id: string;
  username: string;
  coins: number;
  wins: number;
  losses: number;
}

export interface PlayerState {
  id: string;
  username: string;
  coins: number;         // 当前金币（已扣除本局下注）
  score: number;         // 已存分（banked）
  diceSet: string[];     // 装备骰子 id 列表（长度 1..6，不足 6 用 ordinary 补齐）
  badge: string | null;  // 装备徽章 id
  badgeUsesLeft: number; // 本局剩余可用次数
  connected: boolean;
  ready: boolean;
  isHost: boolean;
}

export interface TurnState {
  playerId: string;
  dicePool: DieFace[];         // 当前待选骰池
  selected: number[];          // 玩家当前勾选的下标
  availableCombos: Combo[];    // 服务端计算的合法组合（UI 提示）
  roundScore: number;          // 本回合未存分累计
  canRoll: boolean;
  canBank: boolean;
  badgeAvailable: boolean;     // 当前局面下徽章可用
  badgeUseHint: string | null; // 徽章可用时的提示文案
  deadline: number | null;     // 回合限时截止时间戳（ms）
}

export type RoomStatus = 'waiting' | 'playing' | 'finished';

export interface RoomState {
  roomCode: string;
  status: RoomStatus;
  targetScore: number;
  wager: number;
  pot: number;                          // 奖池 = wager * 2
  badgeTierActive: 'tin' | 'silver' | 'gold' | null; // 双方同等级徽章时生效
  players: PlayerState[];                // 长度 2，index 0 为房主
  currentPlayerIndex: number;
  turn: TurnState | null;
  winnerId: string | null;
  lastEvent: string | null;              // 'game_started'|'rolled'|'bust'|'banked'|'badge_used'|'hot_dice'|'game_over'|'player_left'|'player_reconnected'|'turn_timeout'
}

// ============ 通信协议 ============

export interface Ack<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export interface ClientToServerEvents {
  createRoom: (payload: {
    wager: number;
    targetScore: number;
    diceSet: string[];
    badge: string | null;
  }, ack: (r: Ack<RoomState>) => void) => void;

  joinRoom: (payload: {
    roomCode: string;
    diceSet: string[];
    badge: string | null;
  }, ack: (r: Ack<RoomState>) => void) => void;

  leaveRoom: () => void;
  setReady: (payload: { ready: boolean }) => void;
  toggleSelect: (payload: { index: number }) => void;
  rollDice: () => void;
  bankAndPass: () => void;
  useBadge: () => void;
  forfeit: () => void;
}

export interface ServerToClientEvents {
  roomUpdate: (state: RoomState) => void;
  error: (payload: { code: string; message: string }) => void;
}

export interface AuthResponse {
  token: string;
  user: UserPublic;
}

export interface AuthPayload {
  username: string;
  password: string;
}

/** 错误码约定（error.code）：AUTH_INVALID | ROOM_NOT_FOUND | ROOM_FULL | NOT_YOUR_TURN | BAD_STATE | INVALID_MOVE | INSUFFICIENT_COINS | BAD_INPUT */
