import { useAppStore } from './store';
import type { Store } from './store';
import { AuthPage, LobbyPage } from './pages';
import { GamePage } from './game';
import { CopyCode } from './components';

function Toasts({ store }: { store: Store }) {
  return (
    <div className="toasts">
      {store.toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          className={t.kind === 'error' ? 'toast toast-err' : 'toast'}
          onClick={() => store.dismissToast(t.id)}
        >
          {t.text}
        </button>
      ))}
    </div>
  );
}

export default function App() {
  const store = useAppStore();
  const { user, room } = store;

  if (!user) {
    return (
      <div className="app">
        <AuthPage store={store} />
        <Toasts store={store} />
      </div>
    );
  }

  const inGame = room !== null && room.players.some((p) => p.id === user.id);

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-title">骰子之约</div>
        <div className="topbar-user">
          <span className="coin">{store.myCoins} 金币</span>
          <span className="sep">·</span>
          <span>
            胜负 {store.myWins}/{store.myLosses}
          </span>
          <span className="sep">·</span>
          <span className="who">{user.username}</span>
          {room && (
            <>
              <span className="sep">·</span>
              <span className="rc">
                房间 <strong>{room.roomCode}</strong>
              </span>
              <CopyCode code={room.roomCode} />
            </>
          )}
          <button type="button" className="btn btn-ghost" onClick={store.doLogout}>
            登出
          </button>
        </div>
      </header>

      <main className="main">
        {inGame && room ? <GamePage store={store} room={room} /> : <LobbyPage store={store} />}
      </main>

      {!store.online && <div className="overlay"><div className="overlay-box">连接中断，正在重连…</div></div>}
      <Toasts store={store} />
    </div>
  );
}
