import { HealthController } from './health.controller';
import { PrismaService } from '../prisma/prisma.service';

describe('HealthController', () => {
  const makePrisma = (healthy: boolean): PrismaService =>
    ({ isHealthy: async () => healthy }) as unknown as PrismaService;

  it('liveness returns ok', () => {
    const ctrl = new HealthController(makePrisma(true));
    expect(ctrl.health().status).toBe('ok');
  });

  it('readiness returns ready when DB is up', async () => {
    const ctrl = new HealthController(makePrisma(true));
    await expect(ctrl.ready()).resolves.toEqual({ status: 'ready', db: 'up' });
  });

  it('readiness throws when DB is down', async () => {
    const ctrl = new HealthController(makePrisma(false));
    await expect(ctrl.ready()).rejects.toThrow();
  });
});
