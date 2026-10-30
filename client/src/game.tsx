import { useEffect, useRef, useState } from 'react';
import type { PlayerState, RoomState } from '@shared/types';
import type { Store } from './store';
import { badgeName, dieName } from './catalog';
import { CopyCode, DiceFace } from './components';
import { countdown, eventText, statusText } from './events';

/** 对手是否轮到：完全以服务端 turn 为准 */
function comboIndices(room: RoomState): Set<number> {
  const set = new Set<number>();
  room.turn?.availableCombos.forEach((c) => c.diceIndices.forEach((i) => set.add(i)));
  return set;
}

function PlayerBar({ p, isMe, active }: { p: PlayerState; isMe: boolean; active: boolean }) {
  return (
    <div className={active ? 'pbar pbar-on' : 'pbar'}>
      <div className="pbar-name">
        <strong>{p.username}</strong>
        {isMe && <span className="tag tag-me">我</span>}
        {!p.connected && <span className="tag tag-off">掉线</span>}
        {p.ready && <span className="tag tag-ready">已准备</span>}
      </div>
      <div className="pbar-stats">
        <span>金币 {p.coins}</span>
        <span className="sep">·</span>
        <span>已存分 {p.score}</span>
      </div>
      <div className="pbar-sub">
        <span>徽章：{badgeName(p.badge)}（剩 {p.badgeUsesLeft} 次）</span>
      </div>
      <div className="pbar-sub muted">
        骰子：{p.diceSet.map((id) => dieName(id)).join('、') || '普通骰'}
      </div>
    </div>
  );
}

export function GamePage({ store, room }: { store: Store; room: RoomState }) {
  const [now, setNow] = useState(() => Date.now());
  const prevEvent = useRef<string | null>(null);
  const turn = room.turn;
  const myId = store.meId;
  const myIndex = room.players.findIndex((p) => p.id === myId);
  const isMyTurn = turn !== null && myIndex >= 0 && room.players[myIndex]?.id === turn.playerId;
  const me = myIndex >= 0 ? room.players[myIndex] : undefined;

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    const ev = room.lastEvent;
    if (ev && ev !== prevEvent.current) {
      prevEvent.current = ev;
      const text = eventText(room);
      if (text) store.pushToast(text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.lastEvent]);

  if (room.status === 'waiting') {
    return (
      <div className="center-wrap">
        <section className="card wait-card">
          <h2>等待对手加入 / 准备</h2>
          <p className="mega-code">{room.roomCode}</p>
          <div className="wait-actions">
            <CopyCode code={room.roomCode} />
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => store.setReady(!(me?.ready ?? false))}
            >
              {me?.ready ? '取消准备' : '我已准备'}
            </button>
          </div>
          <div className="players-row">
            {room.players.map((p) => (
              <PlayerBar key={p.id} p={p} isMe={p.id === myId} active={false} />
            ))}
          </div>
          <p className="muted">奖池 {room.pot} 金币 · 目标分 {room.targetScore} · 状态 {statusText(room.status)}</p>
          {room.players.length < 2 && <p className="hint">把房间码告诉同伴，他输入后即可入座。</p>}
        </section>
      </div>
    );
  }

  const hot = turn ? comboIndices(room) : new Set<number>();
  const selected = new Set(turn?.selected ?? []);
  const gameOver = room.status === 'finished';
  const iWon = gameOver && room.winnerId !== null && room.winnerId === myId;

  return (
    <div className="game-wrap">
      <div className="players-row">
        {room.players.map((p, i) => (
          <PlayerBar key={p.id} p={p} isMe={p.id === myId} active={!gameOver && turn?.playerId === p.id && i >= 0} />
        ))}
      </div>

      <section className="card board-card">
        <div className="stat-strip">
          <div className="stat"><span>奖池</span><strong>{room.pot}</strong></div>
          <div className="stat"><span>目标分</span><strong>{room.targetScore}</strong></div>
          <div className="stat"><span>本回合未存</span><strong>{turn?.roundScore ?? 0}</strong></div>
          <div className="stat"><span>限时</span><strong>{countdown(turn?.deadline ?? null, now) ?? '—'}</strong></div>
        </div>

        <h3 className="pool-title">
          {gameOver ? '对局结束' : isMyTurn ? '你的骰池 —— 点击勾选要计分的骰子' : '对手的回合，请稍候'}
        </h3>
        <div className="pool">
          {(turn?.dicePool ?? []).map((face, i) => (
            <DiceFace
              key={i}
              face={face}
              selected={selected.has(i)}
              highlighted={hot.has(i)}
              dimmed={!isMyTurn}
              size={typeof window !== 'undefined' && window.innerWidth < 420 ? 44 : 56}
              onClick={isMyTurn && !gameOver ? () => store.toggleSelect(i) : undefined}
            />
          ))}
          {(turn?.dicePool ?? []).length === 0 && <p className="hint">骰池已清空 —— 掷骰重新开始本轮。</p>}
        </div>

        {turn?.badgeUseHint && <p className="badge-hint">{turn.badgeUseHint}</p>}

        <div className="btn-row">
          <button type="button" className="btn btn-primary" disabled={!isMyTurn || !turn?.canRoll || gameOver} onClick={store.rollDice}>
            掷骰
          </button>
          <button type="button" className="btn" disabled={!isMyTurn || !turn?.canBank || gameOver} onClick={store.bankAndPass}>
            存分过
          </button>
          <button
            type="button"
            className="btn btn-badge"
            disabled={!isMyTurn || !turn?.badgeAvailable || gameOver}
            onClick={store.useBadge}
            title={me?.badge ? badgeName(me.badge) : '未佩戴徽章'}
          >
            使用徽章（剩 {me?.badgeUsesLeft ?? 0}）
          </button>
          <button type="button" className="btn btn-danger" disabled={gameOver} onClick={store.forfeit}>
            认输
          </button>
          <button type="button" className="btn btn-ghost" onClick={store.doLeave}>
            离开房间
          </button>
        </div>

        <div className="event-line">{eventText(room) ?? '静候佳音。'}</div>

        {gameOver && (
          <div className={iWon ? 'result result-win' : 'result result-lose'}>
            <h3>{iWon ? '胜！' : room.winnerId ? '负' : '对局结束'}</h3>
            <p>
              {room.winnerId ? `${room.players.find((p) => p.id === room.winnerId)?.username ?? '对手'} 拿下奖池 ${room.pot} 金币。` : ''}
              {me ? ` 你当前金币 ${me.coins}（本局下注 ${room.wager}）。` : ''}
            </p>
            <button type="button" className="btn" onClick={store.doLeave}>
              返回大厅
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
