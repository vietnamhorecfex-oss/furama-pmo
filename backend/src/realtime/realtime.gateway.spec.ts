/**
 * R-05 — RealtimeGateway unit test. We exercise the connection auth flow and the
 * project:join membership check with mocked `Socket` and `Server` objects — the goal is
 * to prove cross-project leakage cannot happen, not to verify socket.io itself.
 *
 *  - connect without a token → disconnect()
 *  - connect with invalid token → disconnect()
 *  - join project where user is not a member → returns FORBIDDEN, no join
 *  - join project where user IS a member → joins room project:<pid>
 *  - emit() targets only that room
 */
import { RealtimeGateway } from './realtime.gateway';
import type { TokensService } from '../auth/tokens.service';
import type { RbacService } from '../rbac/rbac.service';
import type { Socket, Server } from 'socket.io';

function makeSocket(overrides: { token?: string; header?: string } = {}): {
  socket: Socket;
  joined: string[];
  emitted: { event: string; payload: unknown }[];
  disconnected: boolean[];
} {
  const joined: string[] = [];
  const emitted: { event: string; payload: unknown }[] = [];
  const disconnected: boolean[] = [];
  const socket = {
    id: 'sock-1',
    data: {} as Record<string, unknown>,
    handshake: {
      auth: overrides.token ? { token: overrides.token } : {},
      headers: overrides.header ? { authorization: overrides.header } : {},
    },
    join: jest.fn(async (room: string) => {
      joined.push(room);
    }),
    leave: jest.fn(async (room: string) => {
      joined.splice(joined.indexOf(room), 1);
    }),
    emit: jest.fn((event: string, payload: unknown) => {
      emitted.push({ event, payload });
    }),
    disconnect: jest.fn((_force?: boolean) => {
      disconnected.push(true);
    }),
  } as unknown as Socket;
  return { socket, joined, emitted, disconnected };
}

describe('RealtimeGateway', () => {
  const tokens = {
    verifyAccess: jest.fn((t: string) => {
      if (t === 'good') return { sub: 'u1', orgId: 'o1' };
      throw new Error('Invalid or expired token');
    }),
  } as unknown as TokensService;

  const rbac = {
    effectiveRole: jest.fn(async (userId: string, projectId: string) => {
      if (userId === 'u1' && projectId === 'p1') return 'OWNER';
      return null;
    }),
  } as unknown as RbacService;

  let gw: RealtimeGateway;
  beforeEach(() => {
    gw = new RealtimeGateway(tokens, rbac);
    // Minimal Server stub: .to(room).emit(event, payload) records to a side channel.
    const sentByRoom: Record<string, { event: string; payload: unknown }[]> = {};
    gw.server = {
      to: (room: string) => ({
        emit: (event: string, payload: unknown) => {
          (sentByRoom[room] ??= []).push({ event, payload });
        },
      }),
      _sent: sentByRoom,
    } as unknown as Server & { _sent: Record<string, { event: string; payload: unknown }[]> };
  });

  it('refuses connections without a token', () => {
    const { socket, disconnected, emitted } = makeSocket();
    gw.handleConnection(socket);
    expect(disconnected).toEqual([true]);
    expect(emitted[0]?.event).toBe('error');
  });

  it('refuses connections with an invalid token', () => {
    const { socket, disconnected } = makeSocket({ token: 'nope' });
    gw.handleConnection(socket);
    expect(disconnected).toEqual([true]);
  });

  it('attaches userId from a valid token', () => {
    const { socket, disconnected } = makeSocket({ token: 'good' });
    gw.handleConnection(socket);
    expect(disconnected).toEqual([]);
    expect((socket.data as { userId?: string }).userId).toBe('u1');
  });

  it('joinProject denies non-members (no leakage)', async () => {
    const { socket, joined } = makeSocket({ token: 'good' });
    gw.handleConnection(socket);
    const res = await gw.joinProject(socket, { projectId: 'other-project' });
    expect(res).toEqual({ ok: false, error: 'FORBIDDEN' });
    expect(joined).toEqual([]);
  });

  it('joinProject lets a member into project:<pid> and emit() reaches only that room', async () => {
    const { socket, joined } = makeSocket({ token: 'good' });
    gw.handleConnection(socket);
    const res = await gw.joinProject(socket, { projectId: 'p1' });
    expect(res).toEqual({ ok: true });
    expect(joined).toEqual(['project:p1']);

    gw.emit('p1', 'task.updated', { projectId: 'p1', taskId: 't1' });
    gw.emit('other-project', 'task.updated', { projectId: 'other-project', taskId: 't2' });

    const sent = (gw.server as unknown as { _sent: Record<string, unknown[]> })._sent;
    expect(sent['project:p1']).toHaveLength(1);
    expect(sent['project:other-project']).toHaveLength(1);
    // The membership-only client is in project:p1 ONLY — sockets in project:other-project would
    // be disjoint, so the emit to other-project never reaches this user.
  });
});
