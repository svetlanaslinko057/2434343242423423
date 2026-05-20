import { useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { io, Socket } from 'socket.io-client';

/**
 * Single Socket.IO client for the whole app.
 *
 * Backend is mounted at `/api/socket.io/` (see server.py — the path is set
 * that way so Kubernetes ingress proxies it through `/api/*`).
 *
 * API:
 *   • `getSocket()`          → lazy, shared, auto-authenticates from AsyncStorage
 *   • `useRealtime(rooms, handler)` → React hook: joins rooms while the
 *     component is mounted and forwards every incoming event to `handler`.
 *
 * The backend uses `emit(event, payload, room=...)` across many events
 * (e.g. `workunit.assigned`, `deliverable.created`, `submission.created`,
 * `project.updated` …). Components don't have to know all event names —
 * they just subscribe and get a stream of `{event, payload}`.
 */

const BACKEND_URL = (process.env.EXPO_PUBLIC_BACKEND_URL || '').replace(/\/+$/, '');
const SOCKET_PATH = '/api/socket.io';

let _socket: Socket | null = null;
let _authPromise: Promise<boolean> | null = null;

function makeSocket(): Socket {
  const s = io(BACKEND_URL || undefined, {
    path: SOCKET_PATH,
    transports: ['websocket', 'polling'],
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1_500,
    reconnectionDelayMax: 10_000,
    timeout: 20_000,
  });
  s.on('connect', () => {
    // Always re-authenticate after reconnect so the server re-binds rooms.
    _authPromise = null;
    ensureAuth(s).catch(() => {});
  });
  return s;
}

async function ensureAuth(s: Socket): Promise<boolean> {
  if (_authPromise) return _authPromise;
  _authPromise = (async () => {
    try {
      const token = await AsyncStorage.getItem('atlas_token');
      if (!token) return false;
      return new Promise<boolean>((resolve) => {
        s.emit('authenticate', { token }, (ack: any) => {
          resolve(Boolean(ack && ack.ok));
        });
      });
    } catch {
      return false;
    }
  })();
  return _authPromise;
}

export function getSocket(): Socket {
  if (!_socket) _socket = makeSocket();
  return _socket;
}

/**
 * Join a set of rooms for the lifetime of the component and receive every
 * event the backend emits on those rooms.
 *
 * Usage:
 *   useRealtime([`project:${id}`], (event, payload) => {
 *     if (event === 'deliverable.created') pushActivity(...);
 *   });
 */
export function useRealtime(
  rooms: string[],
  onEvent: (event: string, payload: any) => void,
) {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;
  // Serialize rooms to avoid useEffect thrash when the caller passes a new
  // array reference every render with the same contents.
  const roomsKey = rooms.join('|');

  useEffect(() => {
    const s = getSocket();
    let alive = true;
    let joinedRooms: string[] = [];

    // Forward every event payload into the consumer's handler.
    // We use the catch-all onAny so components don't have to enumerate events.
    const any = (event: string, payload: any) => {
      if (!alive) return;
      // Ignore the built-in connect/disconnect events — components don't care.
      if (event === 'connect' || event === 'disconnect' || event === 'connect_error') return;
      handlerRef.current(event, payload);
    };
    s.onAny(any);

    (async () => {
      const authed = await ensureAuth(s);
      if (!authed || !alive) return;
      const split = rooms.filter(Boolean);
      if (!split.length) return;
      await new Promise<void>((resolve) => {
        s.emit('join', { rooms: split }, (ack: any) => {
          if (ack && Array.isArray(ack.joined)) joinedRooms = ack.joined;
          resolve();
        });
      });
    })();

    return () => {
      alive = false;
      try { s.offAny(any); } catch { /* noop */ }
      if (joinedRooms.length) {
        try { s.emit('leave', { rooms: joinedRooms }); } catch { /* noop */ }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomsKey]);
}
