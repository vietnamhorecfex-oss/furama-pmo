/**
 * W-02 — Socket.io client + TanStack Query cache patcher.
 *
 * Strategy: rather than rewriting the cache with shape-aware mutations (fragile across
 * filter combinations), we invalidate the relevant query keys on each event. The fetcher
 * then re-pulls from /api/v1 — cheap (1 round-trip) and guaranteed correct.
 *
 * Reconnect strategy is built into socket.io; on reconnect the client re-issues project:join
 * for every project it had joined.
 */
import { io, type Socket } from 'socket.io-client';
import type { WsEventMap } from '@furama/shared';
import { useAuth } from './auth-store';
import { queryClient } from './query-client';

let socket: Socket | null = null;
const joined = new Set<string>();

export function connectWs(): Socket {
  if (socket?.connected) return socket;
  const token = useAuth.getState().accessToken;
  socket = io('/ws', {
    auth: { token },
    transports: ['websocket'],
    withCredentials: true,
  });

  socket.on('connect', () => {
    for (const projectId of joined) {
      socket?.emit('project:join', { projectId });
    }
  });

  // Cache invalidation per event type.
  socket.on('task.created', (e: WsEventMap['task.created']) => {
    queryClient.invalidateQueries({ queryKey: ['tasks', e.projectId] });
  });
  socket.on('task.updated', (e: WsEventMap['task.updated']) => {
    queryClient.invalidateQueries({ queryKey: ['tasks', e.projectId] });
    queryClient.invalidateQueries({ queryKey: ['task', e.taskId] });
  });
  socket.on('task.deleted', (e: WsEventMap['task.deleted']) => {
    queryClient.invalidateQueries({ queryKey: ['tasks', e.projectId] });
  });
  socket.on('task.progress', (e: WsEventMap['task.progress']) => {
    queryClient.invalidateQueries({ queryKey: ['tasks', e.projectId] });
    queryClient.invalidateQueries({ queryKey: ['task', e.taskId] });
  });
  socket.on('comment.created', (e: WsEventMap['comment.created']) => {
    queryClient.invalidateQueries({ queryKey: ['comments', e.taskId] });
  });

  return socket;
}

export function joinProjectRoom(projectId: string): void {
  joined.add(projectId);
  const s = connectWs();
  if (s.connected) s.emit('project:join', { projectId });
}

export function leaveProjectRoom(projectId: string): void {
  joined.delete(projectId);
  socket?.emit('project:leave', { projectId });
}

export function disconnectWs(): void {
  socket?.disconnect();
  socket = null;
  joined.clear();
}
