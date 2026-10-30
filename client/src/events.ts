import type { RoomState } from '@shared/types';

/** lastEvent → 中文提示（纯展示；一切规则判定由服务端做出） */
const EVENT_TEXT: Record<string, (room: RoomState) => string> = {
  game_started: () => '对局开始，愿幸运女神眷顾你。',
  rolled: (room) => `${who(room)}掷出了骰子。`,
  bust: (room) => `${who(room)}爆掉了——一颗都没能计分！`,
  banked: (room) => `${who(room)}存分过。`,
  badge_used: (room) => `${who(room)}使用了徽章。`,
  hot_dice: (room) => `${who(room)}掷出了热骰（骰池已清空）！`,
  game_over: (room) => (room.winnerId ? `${nameOf(room, room.winnerId)} 赢得了这局！` : '对局结束。'),
  player_left: (room) => `${fallbackName(room)} 离开了房间。`,
  player_reconnected: (room) => `${fallbackName(room)} 重新连上了。`,
  turn_timeout: (room) => `${who(room)}超时，回合自动结束。`,
};

function nameOf(room: RoomState, id: string): string {
  return room.players.find((p) => p.id === id)?.username ?? '某位赌徒';
}

function who(room: RoomState): string {
  const idx = room.currentPlayerIndex;
  const p = room.players[idx];
  return p ? p.username : '对手';
}

function fallbackName(room: RoomState): string {
  return room.players[0]?.username ?? '玩家';
}

export function eventText(room: RoomState): string | null {
  const key = room.lastEvent;
  if (!key) return null;
  const fn = EVENT_TEXT[key];
  return fn ? fn(room) : `事件：${key}`;
}

export function statusText(status: RoomState['status']): string {
  return status === 'waiting' ? '等待对手' : status === 'playing' ? '对局中' : '已结束';
}

export function countdown(deadline: number | null, now: number): string | null {
  if (deadline === null) return null;
  const left = Math.max(0, Math.round((deadline - now) / 1000));
  return `${left} 秒`;
}
