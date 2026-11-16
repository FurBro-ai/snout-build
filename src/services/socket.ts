import { io, type Socket } from 'socket.io-client';
import { getStoredToken } from './api.ts';

let socketInstance: Socket | null = null;

export function connectChordSocket(): Socket | null {
  const token = getStoredToken();
  if (!token) return null;

  if (socketInstance) {
    if (socketInstance.connected) return socketInstance;
    socketInstance.auth = { token };
    socketInstance.connect();
    return socketInstance;
  }

  socketInstance = io({
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 15,
    reconnectionDelay: 1000,
  });

  return socketInstance;
}

export function getChordSocket(): Socket | null {
  return socketInstance;
}

export function disconnectChordSocket() {
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }
}
