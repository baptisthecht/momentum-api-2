import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Session, SessionStatus } from '../session/session.entity';
import { BitgetSyncService } from './bitget-sync.service';

/**
 * SyncSchedulerService — périodiquement synchronise les sessions réelles actives.
 *
 * - Toutes les 30s  : balance + positions ouvertes (détection fermetures externes)
 * - Toutes les 5min : réconciliation complète (fills + trades)
 */
@Injectable()
export class SyncSchedulerService {
  private readonly log = new Logger(SyncSchedulerService.name);
  private syncing = false;

  constructor(
    @InjectRepository(Session) private readonly sessionRepo: Repository<Session>,
    private readonly sync: BitgetSyncService,
  ) {}

  /** Sync léger toutes les 30s : balance + positions */
  @Cron('*/30 * * * * *')
  async syncLive() {
    if (this.syncing) return;
    this.syncing = true;
    try {
      const sessions = await this.sessionRepo.find({
        where: { status: SessionStatus.RUNNING, simulation: false },
        relations: ['user'],
      });
      for (const session of sessions) {
        try {
          await this.sync.syncSession(session);
        } catch (e: any) {
          this.log.warn(`Sync failed for session ${session.id}: ${e.message}`);
        }
      }
    } finally {
      this.syncing = false;
    }
  }
}
