import {
  Controller, Get, Post, Param, UseGuards, NotFoundException, ForbiddenException,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Session } from '../session/session.entity';
import { BitgetSyncService } from './bitget-sync.service';

@ApiTags('Sync')
@ApiBearerAuth()
@Controller('sessions/:sessionId/sync')
@UseGuards(JwtAuthGuard)
export class SyncController {
  constructor(
    @InjectRepository(Session) private readonly sessionRepo: Repository<Session>,
    private readonly sync: BitgetSyncService,
  ) {}

  /**
   * GET /sessions/:id/sync/snapshot
   * Live snapshot: balance + open positions + TP/SL orders from Bitget.
   * Uses a short-lived cache (30s balance, 10s positions).
   */
  @Get('snapshot')
  @ApiOperation({ summary: 'Live snapshot: balance, open positions and TP/SL orders from Bitget' })
  async snapshot(
    @CurrentUser() user: { id: string },
    @Param('sessionId') sessionId: string,
  ) {
    const session = await this.loadSession(sessionId, user.id);
    return this.sync.getSnapshot(session);
  }

  /**
   * POST /sessions/:id/sync/reconcile
   * Full reconciliation: pulls Bitget positions, detects external closures,
   * updates DB balance/positions/liqPrice.
   */
  @Post('reconcile')
  @ApiOperation({ summary: 'Full reconciliation: detect external closures and update DB from Bitget' })
  async reconcile(
    @CurrentUser() user: { id: string },
    @Param('sessionId') sessionId: string,
  ) {
    const session = await this.loadSession(sessionId, user.id);
    return this.sync.syncSession(session);
  }

  /**
   * GET /sessions/:id/sync/fills
   * Recent fill history from Bitget. Marks fills not recorded in DB as external.
   */
  @Get('fills')
  @ApiOperation({ summary: 'Recent fill history from Bitget (with external detection)' })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Number of fills (default 50)' })
  async fills(
    @CurrentUser() user: { id: string },
    @Param('sessionId') sessionId: string,
    @Query('limit') limit?: string,
  ) {
    const session = await this.loadSession(sessionId, user.id);
    return this.sync.getFillHistory(session, limit ? parseInt(limit, 10) : 50);
  }

  private async loadSession(sessionId: string, userId: string): Promise<Session> {
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId, userId },
      relations: ['user'],
    });
    if (!session) throw new NotFoundException('Session not found');
    if (session.userId !== userId) throw new ForbiddenException();
    return session;
  }
}
