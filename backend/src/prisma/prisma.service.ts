/**
 * S-05 — PrismaService: single DB access point (DB access lives only in services/repositories).
 * Connection failure at boot is logged but NOT fatal, so liveness (/health) stays up while
 * readiness (/ready) reflects real DB connectivity.
 */
import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.logger.log('Connected to database');
    } catch (err) {
      this.logger.warn(
        `Database not reachable at boot (${(err as Error).message}). ` +
          'Readiness will report unhealthy until DB is available.',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Lightweight connectivity probe for the readiness endpoint. */
  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
