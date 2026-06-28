/**
 * T-07 — Import/Export endpoints (docs/04 §3). All gated by IMPORT_EXPORT capability,
 * enforced inside the service. CSV export streams as text/csv.
 */
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  JwtAuthGuard,
  ProjectMemberGuard,
  type AuthedRequest,
} from '../rbac/guards';
import { ImportExportService, type ImportResult } from './import-export.service';

function ctxFromReq(req: AuthedRequest): { userId: string; orgId: string; ip: string | null } {
  return { userId: req.user.sub, orgId: req.user.orgId, ip: req.ip ?? null };
}

@Controller('projects/:projectId')
@UseGuards(JwtAuthGuard, ProjectMemberGuard)
export class ImportExportController {
  constructor(private readonly io: ImportExportService) {}

  @Post('import')
  @HttpCode(HttpStatus.OK)
  importPackedSeed(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ): Promise<ImportResult> {
    const c = ctxFromReq(req);
    return this.io.importPackedSeed(c, projectId, body, c.ip);
  }

  @Get('export')
  exportProject(@Param('projectId') projectId: string, @Req() req: AuthedRequest) {
    return this.io.exportProject(ctxFromReq(req), projectId);
  }

  @Get('export/tasks.csv')
  @Header('content-type', 'text/csv; charset=utf-8')
  exportTasksCsv(@Param('projectId') projectId: string, @Req() req: AuthedRequest): Promise<string> {
    return this.io.exportTasksCsv(ctxFromReq(req), projectId);
  }
}
