import { io } from 'socket.io-client';

// Get API URL from environment
const API_URL = process.env.REACT_APP_BACKEND_URL || '';

// Socket instance (singleton)
let socket = null;
let isAuthenticated = false;

/**
 * Get session token from cookie
 */
function getSessionToken() {
  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split('=');
    if (name === 'session_token') {
      return value;
    }
  }
  return null;
}

/**
 * Get or create socket connection
 */
export function getSocket() {
  if (!socket) {
    socket = io(API_URL.replace('/api', ''), {
      // IS-1 hotfix (Stage 3.5/B): backend mounts Socket.IO at
      // `/api/socket.io/` (server.py: socketio_path="api/socket.io") to match
      // the Kubernetes ingress that only proxies `/api/*` to the backend.
      // Without this `path` override the client defaults to `/socket.io/` and
      // never reaches the backend through the ingress — silent realtime
      // degrade. Expo client (frontend/src/realtime.ts) already uses the
      // correct path; only the web client needed this fix.
      path: '/api/socket.io/',
      transports: ['websocket', 'polling'],
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });

    socket.on('connect', () => {
      console.log('[Socket] Connected:', socket.id);
      isAuthenticated = false; // Reset on reconnect
    });

    socket.on('disconnect', (reason) => {
      console.log('[Socket] Disconnected:', reason);
      isAuthenticated = false;
    });

    socket.on('connect_error', (error) => {
      console.log('[Socket] Connection error:', error.message);
    });
  }

  return socket;
}

/**
 * Authenticate socket connection
 */
export async function authenticateSocket() {
  const s = getSocket();
  const token = getSessionToken();
  
  if (!token) {
    console.log('[Socket] No session token, skipping auth');
    return false;
  }
  
  return new Promise((resolve) => {
    const doAuth = () => {
      s.emit('authenticate', { token }, (response) => {
        if (response?.ok) {
          isAuthenticated = true;
          console.log('[Socket] Authenticated as', response.user_id);
          resolve(true);
        } else {
          console.log('[Socket] Auth failed:', response?.error);
          resolve(false);
        }
      });
    };
    
    if (s.connected) {
      doAuth();
    } else {
      s.once('connect', doAuth);
    }
  });
}

/**
 * Disconnect socket
 */
export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
    isAuthenticated = false;
  }
}

/**
 * Join rooms based on user role and context (requires authentication)
 */
export async function joinRooms(rooms) {
  const s = getSocket();
  
  // Ensure authenticated first
  if (!isAuthenticated) {
    await authenticateSocket();
  }
  
  return new Promise((resolve) => {
    const doJoin = () => {
      s.emit('join', { rooms }, (response) => {
        if (response?.ok) {
          console.log('[Socket] Joined rooms:', response.joined);
          if (response.denied?.length) {
            console.warn('[Socket] Denied rooms:', response.denied);
          }
          resolve(response);
        } else {
          console.error('[Socket] Join failed:', response?.error);
          resolve(response);
        }
      });
    };
    
    if (s.connected) {
      doJoin();
    } else {
      s.once('connect', doJoin);
    }
  });
}

/**
 * Leave rooms
 */
export function leaveRooms(rooms) {
  const s = getSocket();
  s.emit('leave', { rooms });
}

export default getSocket;
