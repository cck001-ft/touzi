import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RoomState, UserPublic } from '@shared/types';
import {
  clearSession,
  connectSocket,
  createRoom as apiCreateRoom,
  getToken,
  joinRoom as apiJoinRoom,
  loadUser,
  login as apiLogin,
  register as apiRegister,
  roomActions,
  saveSession,
} from './net';
import type { AppSocket, CreateRoomInput } from './net';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

export interface JoinInput {
  roomCode: string;
  diceSet: string[];
  badge: string | null;
}

export interface Store {
  user: UserPublic | null;
  room: RoomState | null;
  myCoins: number;
  myWins: number;
  myLosses: number;
  meId: string | null;
  online: boolean;
  toasts: Toast[];
  busy: boolean;
  doLogin: (username: string, password: string) => Promise<boolean>;
  doRegister: (username: string, password: string) => Promise<boolean>;
  doLogout: () => void;
  doCreateRoom: (input: CreateRoomInput) => Promise<boolean>;
  doJoinRoom: (input: JoinInput) => Promise<boolean>;
  doLeave: () => void;
  setReady: (ready: boolean) => void;
  toggleSelect: (index: number) => void;
  rollDice: () => void;
  bankAndPass: () => void;
  useBadge: () => void;
  forfeit: () => void;
  pushToast: (text: string, kind?: Toast['kind']) => void;
  dismissToast: (id: number) => void;
}

export function useAppStore(): Store {
  const [user, setUser] = useState<UserPublic | null>(() => loadUser());
  const [room, setRoom] = useState<RoomState | null>(null);
  const [online, setOnline] = useState<boolean>(() => getToken() !== null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [busy, setBusy] = useState(false);
  const socketRef = useRef<AppSocket | null>(null);
  const toastSeq = useRef(0);

  const pushToast = useCallback((text: string, kind: Toast['kind'] = 'info') => {
    const id = ++toastSeq.current;
    setToasts((prev) => [...prev.slice(-3), { id, text, kind }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4200);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const attach = useCallback(
    (token: string) => {
      socketRef.current?.removeAllListeners();
      socketRef.current?.disconnect();
      const socket = connectSocket(token);
      socketRef.current = socket;
      socket.on('roomUpdate', (state) => setRoom(state));
      socket.on('error', (payload) => pushToast(payload.message || '操作被服务器拒绝', 'error'));
      socket.on('connect', () => setOnline(true));
      socket.on('disconnect', () => setOnline(false));
      socket.io.on('reconnect_error', () => setOnline(false));
    },
    [pushToast],
  );

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    attach(token);
    return () => {
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [attach]);

  const finishAuth = useCallback(
    async (username: string, password: string, mode: 'login' | 'register') => {
      setBusy(true);
      try {
        const res = mode === 'login' ? await apiLogin({ username, password }) : await apiRegister({ username, password });
        saveSession(res);
        setUser(res.user);
        setRoom(null);
        attach(res.token);
        pushToast(`欢迎，${res.user.username}`);
        return true;
      } catch (e) {
        pushToast(e instanceof Error ? e.message : '登录失败', 'error');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [attach, pushToast],
  );

  const doLogin = useCallback((u: string, p: string) => finishAuth(u, p, 'login'), [finishAuth]);
  const doRegister = useCallback((u: string, p: string) => finishAuth(u, p, 'register'), [finishAuth]);

  const doLogout = useCallback(() => {
    socketRef.current?.disconnect();
    socketRef.current = null;
    clearSession();
    setUser(null);
    setRoom(null);
    setOnline(false);
  }, []);

  const runRoomCall = useCallback(
    async (fn: (socket: AppSocket) => Promise<{ ok: boolean; data?: RoomState; error?: { code: string; message: string } }>) => {
      const socket = socketRef.current;
      if (!socket) {
        pushToast('尚未连接服务器，请重新登录', 'error');
        return false;
      }
      setBusy(true);
      try {
        const res = await fn(socket);
        if (res.ok && res.data) {
          setRoom(res.data);
          pushToast(res.data.status === 'waiting' ? `房间 ${res.data.roomCode} 已就绪` : '进入对局');
          return true;
        }
        pushToast(res.error?.message ?? '服务器拒绝了该操作', 'error');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [pushToast],
  );

  const doCreateRoom = useCallback(
    (input: CreateRoomInput) => runRoomCall((socket) => apiCreateRoom(socket, input)),
    [runRoomCall],
  );

  const doJoinRoom = useCallback(
    (input: JoinInput) => runRoomCall((socket) => apiJoinRoom(socket, input)),
    [runRoomCall],
  );

  const doLeave = useCallback(() => {
    const socket = socketRef.current;
    if (socket) roomActions.leaveRoom(socket);
    setRoom(null);
    pushToast('已离开房间');
  }, [pushToast]);

  const emit = useCallback(
    (fn: (s: AppSocket) => void) => {
      const s = socketRef.current;
      if (s) fn(s);
    },
    [],
  );

  const me = useMemo(() => {
    if (!room || !user) return null;
    return room.players.find((p) => p.id === user.id) ?? null;
  }, [room, user]);

  return {
    user,
    room,
    myCoins: me?.coins ?? user?.coins ?? 0,
    myWins: user?.wins ?? 0,
    myLosses: user?.losses ?? 0,
    meId: user?.id ?? null,
    online,
    toasts,
    busy,
    doLogin,
    doRegister,
    doLogout,
    doCreateRoom,
    doJoinRoom,
    doLeave,
    setReady: (ready) => emit((s) => roomActions.setReady(s, ready)),
    toggleSelect: (index) => emit((s) => roomActions.toggleSelect(s, index)),
    rollDice: () => emit((s) => roomActions.rollDice(s)),
    bankAndPass: () => emit((s) => roomActions.bankAndPass(s)),
    useBadge: () => emit((s) => roomActions.useBadge(s)),
    forfeit: () => emit((s) => roomActions.forfeit(s)),
    pushToast,
    dismissToast,
  };
}
