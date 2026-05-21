// Singleton socket.io-client connection for the admin dashboard.
//
// Why a singleton: we want every component that subscribes (Revenue
// Summary today, more tomorrow) to share ONE underlying WebSocket
// instead of each opening its own connection. socket.io reconnects
// automatically when the network blips, so callers just listen.
//
// Auth: the backend's authenticateSocket allows two paths —
//   1. a real JWT in `auth.token` (production, once admin login ships),
//   2. `auth.admin === true` when ADMIN_DEV_OPEN=true on the backend.
// This file uses path #2 for now; replace with the JWT lookup when the
// admin login flow lands. See backend src/config/socket.js for both
// branches.

import { io, type Socket } from 'socket.io-client';

// The HTTP base URL points at /api; the socket root is the host without
// the path suffix. We derive it once so the env override remains the
// single source of truth for the backend location.
const HTTP_BASE =
  process.env.NEXT_PUBLIC_API_URL || 'https://flipon-backend.onrender.com/api';
const SOCKET_URL = HTTP_BASE.replace(/\/api\/?$/, '');

let socketInstance: Socket | null = null;

export const getAdminSocket = (): Socket => {
  if (typeof window === 'undefined') {
    // SSR guard — never instantiate during Next's server render.
    throw new Error('getAdminSocket must only be called on the client');
  }
  if (socketInstance && socketInstance.connected) return socketInstance;
  if (socketInstance) return socketInstance; // already connecting; reuse

  socketInstance = io(SOCKET_URL, {
    auth: { admin: true }, // dev-open opt-in (see backend authenticateSocket)
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    autoConnect: true,
  });

  // Lightweight diagnostics — only log connect/disconnect events. Avoid
  // logging every emitted event so we don't pollute the console.
  socketInstance.on('connect', () => {
    console.log('[admin-socket] connected', socketInstance?.id);
  });
  socketInstance.on('disconnect', (reason) => {
    console.log('[admin-socket] disconnected:', reason);
  });
  socketInstance.on('connect_error', (err) => {
    console.warn('[admin-socket] connect error:', err.message);
  });

  return socketInstance;
};
