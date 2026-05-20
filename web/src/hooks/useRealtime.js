import { useEffect, useRef, useState, useCallback } from 'react';
import { getSocket, joinRooms } from '../lib/socket';

/**
 * Hook to join realtime rooms
 * @param {string[]} rooms - Array of room names to join
 */
export function useRealtimeRooms(rooms) {
  const joinedRef = useRef(false);

  useEffect(() => {
    if (!rooms || rooms.length === 0) return;
    
    const socket = getSocket();
    
    const doJoin = () => {
      if (!joinedRef.current) {
        joinRooms(rooms);
        joinedRef.current = true;
      }
    };

    if (socket.connected) {
      doJoin();
    } else {
      socket.once('connect', doJoin);
    }

    return () => {
      joinedRef.current = false;
    };
  }, [JSON.stringify(rooms)]);
}

/**
 * Hook to subscribe to realtime events
 * @param {Object} handlers - { eventName: (payload) => void }
 */
export function useRealtimeEvents(handlers) {
  useEffect(() => {
    const socket = getSocket();

    // Subscribe to events
    Object.entries(handlers).forEach(([event, handler]) => {
      socket.on(event, handler);
    });

    // Cleanup
    return () => {
      Object.entries(handlers).forEach(([event, handler]) => {
        socket.off(event, handler);
      });
    };
  }, []);
}

/**
 * Hook to setup realtime for a specific role
 * @param {string} userId 
 * @param {string} role 
 * @param {string[]} extraRooms - Optional extra rooms (like project IDs)
 */
export function useRealtimeSetup(userId, role, extraRooms = []) {
  useEffect(() => {
    if (!userId || !role) return;

    const rooms = [
      `user:${userId}`,
      `role:${role}`,
      ...extraRooms
    ];

    joinRooms(rooms);
    console.log('[Realtime] Joined rooms:', rooms);
  }, [userId, role, JSON.stringify(extraRooms)]);
}

/**
 * Hook to track socket connection status
 * Returns: 'connected' | 'connecting' | 'disconnected'
 */
export function useConnectionStatus() {
  const [status, setStatus] = useState('connecting');

  useEffect(() => {
    const socket = getSocket();

    const onConnect = () => setStatus('connected');
    const onDisconnect = () => setStatus('disconnected');
    const onError = () => setStatus('disconnected');
    const onReconnecting = () => setStatus('connecting');

    // Check initial state
    if (socket.connected) {
      setStatus('connected');
    }

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onError);
    socket.io?.on('reconnect_attempt', onReconnecting);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onError);
      socket.io?.off('reconnect_attempt', onReconnecting);
    };
  }, []);

  return status;
}

/**
 * Hook to track live event count (notification badge)
 * Resets when user calls resetCount()
 */
export function useEventCounter() {
  const [count, setCount] = useState(0);
  
  const increment = useCallback(() => {
    setCount(c => c + 1);
  }, []);
  
  const resetCount = useCallback(() => {
    setCount(0);
  }, []);
  
  return { count, increment, resetCount };
}

export default useRealtimeEvents;
