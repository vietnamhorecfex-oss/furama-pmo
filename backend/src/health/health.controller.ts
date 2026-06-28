/**
 * S-08 — Liveness (/health) and readiness (/ready) probes.
 * /health = process is up (always 200). /ready = dependencies (DB) reachable.
 */
import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('health')
  health(): { status: 'ok'; uptime: number } {
    return { status: 'ok', uptime: process.uptime() };
  }

  @Get('ready')
  async ready(): Promise<{ status: 'ready'; db: 'up' }> {
    const dbUp = await this.prisma.isHealthy();
    if (!dbUp) {
      throw new ServiceUnavailableException('Database not reachable');
    }
    return { status: 'ready', db: 'up' };
  }
}
