import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Store } from './store';
import { TARGET_SCORES } from './catalog';
import { BadgePicker, CopyCode, DicePicker, diceSlotsToSet, makeEmptyDiceSlots } from './components';

// ============ 登录 / 注册 ============

export function AuthPage({ store }: { store: Store }) {
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      store.pushToast('请填写用户名与密码', 'error');
      return;
    }
    const ok = tab === 'login' ? await store.doLogin(username.trim(), password) : await store.doRegister(username.trim(), password);
    if (ok) {
      setPassword('');
    }
  };

  return (
    <div className="center-wrap">
      <section className="card auth-card">
        <h1 className="brand">骰子之约</h1>
        <p className="brand-sub">波希米亚赌局 · 服务端权威骰池</p>
        <div className="tab-row">
          <button type="button" className={tab === 'login' ? 'tab tab-on' : 'tab'} onClick={() => setTab('login')}>
            登录
          </button>
          <button type="button" className={tab === 'register' ? 'tab tab-on' : 'tab'} onClick={() => setTab('register')}>
            注册
          </button>
        </div>
        <form onSubmit={submit} className="form-col">
          <label className="field">
            <span>名号</span>
            <input
              className="input"
              value={username}
              autoComplete="username"
              maxLength={24}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="如 SirRadig"
            />
          </label>
          <label className="field">
            <span>口令</span>
            <input
              className="input"
              type="password"
              value={password}
              autoComplete="current-password"
              maxLength={64}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </label>
          <button type="submit" className="btn btn-primary" disabled={store.busy}>
            {store.busy ? '正在办理…' : tab === 'login' ? '进入大厅' : '登记名号'}
          </button>
        </form>
      </section>
    </div>
  );
}

// ============ 大厅 ============

export function LobbyPage({ store }: { store: Store }) {
  const [wager, setWager] = useState('100');
  const [targetScore, setTargetScore] = useState(2000);
  const [slots, setSlots] = useState<(string | null)[]>(makeEmptyDiceSlots);
  const [badge, setBadge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [joinSlots, setJoinSlots] = useState<(string | null)[]>(makeEmptyDiceSlots);
  const [joinBadge, setJoinBadge] = useState<string | null>(null);

  const wagerNum = Number(wager);

  const onCreate = async () => {
    if (!Number.isFinite(wagerNum) || wagerNum <= 0) {
      store.pushToast('下注额需为正数', 'error');
      return;
    }
    await store.doCreateRoom({ wager: Math.floor(wagerNum), targetScore, diceSet: diceSlotsToSet(slots), badge });
  };

  const onJoin = async () => {
    if (!/^[A-Za-z0-9]{4,8}$/.test(code.trim())) {
      store.pushToast('请输入正确的房间码', 'error');
      return;
    }
    await store.doJoinRoom({ roomCode: code.trim().toUpperCase(), diceSet: diceSlotsToSet(joinSlots), badge: joinBadge });
  };

  return (
    <div className="lobby-grid">
      <section className="card">
        <h2>开设赌局</h2>
        <div className="form-col">
          <label className="field">
            <span>下注额（金币）</span>
            <input className="input" value={wager} inputMode="numeric" onChange={(e) => setWager(e.target.value.replace(/[^0-9]/g, ''))} />
          </label>
          <label className="field">
            <span>目标分</span>
            <select className="input" value={targetScore} onChange={(e) => setTargetScore(Number(e.target.value))}>
              {TARGET_SCORES.map((t) => (
                <option key={t} value={t}>
                  {t} 分
                </option>
              ))}
            </select>
          </label>
          <div className="field">
            <span>骰子（最多 6 格，空位用普通骰补齐）</span>
            <DicePicker value={slots} onChange={setSlots} />
          </div>
          <div className="field">
            <span>徽章（可不选）</span>
            <BadgePicker value={badge} onChange={setBadge} />
          </div>
          <button type="button" className="btn btn-primary" onClick={onCreate} disabled={store.busy}>
            {store.busy ? '请求中…' : '创建房间'}
          </button>
        </div>
      </section>

      <section className="card">
        <h2>应募赌局</h2>
        <div className="form-col">
          <label className="field">
            <span>房间码（6 位）</span>
            <input
              className="input input-code"
              value={code}
              maxLength={8}
              placeholder="ABC123"
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            />
          </label>
          <div className="field">
            <span>骰子</span>
            <DicePicker value={joinSlots} onChange={setJoinSlots} />
          </div>
          <div className="field">
            <span>徽章（可不选）</span>
            <BadgePicker value={joinBadge} onChange={setJoinBadge} />
          </div>
          <button type="button" className="btn" onClick={onJoin} disabled={store.busy}>
            加入房间
          </button>
        </div>

        {store.room && (
          <div className="room-line">
            <div>
              所在房间码：<strong className="code-strong">{store.room.roomCode}</strong>
              <span className="muted"> （{store.room.status === 'waiting' ? '等待对手' : '已进入'}）</span>
            </div>
            <CopyCode code={store.room.roomCode} />
          </div>
        )}
      </section>
    </div>
  );
}
