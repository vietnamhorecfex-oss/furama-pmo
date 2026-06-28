/**
 * R-04 — RealtimeGateway. WebSocket namespace `/ws`.
 *
 * Auth: the client connects with the access token via `auth: { token: '...' }` (preferred)
 * or `Authorization: Bearer ...` header. We verify it via TokensService and pin
 * `socket.data.userId` for the lifetime of the connection.
 *
 * Rooms: clients explicitly send `project:join { projectId }`. The server verifies the user
 * is a member of that project (RbacService.effectiveRole) before adding the socket to
 * `project:<pid>`. Without this, a hostile client could join any room and listen in — which
 * is exactly the "cross-project leakage" R-05 asserts against.
 *
 * Fan-out: a single `emit(projectId, event, payload)` API for services. In-memory adapter
 * is used by default; the @socket.io/redis-adapter can be plugged at AppModule level later
 * when we scale horizontally (docs/01 §5 — multi-instance fan-out).
 */
import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { WsEventMap, WsEventName } from '@furama/shared';
import { TokensService } from '../auth/tokens.service';
import { RbacService } from '../rbac/rbac.service';

interface SocketData {
  userId?: string;
  orgId?: string;
  joinedProjects: Set<string>;
}

@WebSocketGateway({
  namespace: 'ws',
  cors: { origin: '*', credentials: true }, // CORS allow-list is handled at HTTP level; WS is token-auth'd
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly tokens: TokensService,
    private readonly rbac: RbacService,
  ) {}

  // ----- connection lifecycle -----
  handleConnection(client: Socket): void {
    try {
      const token = extractToken(client);
      if (!token) {
        client.emit('error', { code: 'UNAUTHORIZED', message: 'Missing token' });
        client.disconnect(true);
        return;
      }
      const claims = this.tokens.verifyAccess(token);
      const data = client.data as SocketData;
      data.userId = claims.sub;
      data.orgId = claims.orgId;
      data.joinedProjects = new Set();
      this.logger.debug(`WS connect user=${claims.sub} socket=${client.id}`);
    } catch (err) {
      client.emit('error', { code: 'UNAUTHORIZED', message: (err as Error).message });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`WS disconnect socket=${client.id}`);
  }

  // ----- client → server -----
  @SubscribeMessage('project:join')
  async joinProject(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ): Promise<{ ok: boolean; error?: string }> {
    const projectId = readProjectId(payload);
    const data = client.data as SocketData;
    if (!data.userId || !projectId) return { ok: false, error: 'INVALID' };

    const role = await this.rbac.effectiveRole(data.userId, projectId);
    if (!role) return { ok: false, error: 'FORBIDDEN' };

    const room = roomName(projectId);
    await client.join(room);
    data.joinedProjects.add(projectId);
    return { ok: true };
  }

  @SubscribeMessage('project:leave')
  async leaveProject(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: unknown,
  ): Promise<{ ok: boolean }> {
    const projectId = readProjectId(payload);
    if (!projectId) return { ok: false };
    const data = client.data as SocketData;
    await client.leave(roomName(projectId));
    data.joinedProjects.delete(projectId);
    return { ok: true };
  }

  // ----- server → client -----
  /** Fan-out an event to all sockets joined to the project's room. */
  emit<E extends WsEventName>(projectId: string, event: E, payload: WsEventMap[E]): void {
    this.server.to(roomName(projectId)).emit(event, payload);
  }
}

function extractToken(client: Socket): string | null {
  const fromAuth = (client.handshake.auth as { token?: string } | undefined)?.token;
  if (fromAuth) return fromAuth;
  const header = client.handshake.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    return header.slice('Bearer '.length).trim();
  }
  return null;
}

function readProjectId(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const id = (payload as { projectId?: unknown }).projectId;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

function roomName(projectId: string): string {
  return `project:${projectId}`;
}
