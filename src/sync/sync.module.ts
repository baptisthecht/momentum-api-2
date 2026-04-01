import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { BitgetSyncService } from './bitget-sync.service';
import { SyncController } from './sync.controller';
import { SyncSchedulerService } from './sync-scheduler.service';
import { Session } from '../session/session.entity';
import { Position } from '../position/position.entity';
import { Trade } from '../trade/trade.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Session, Position, Trade]),
    ScheduleModule.forRoot(),
  ],
  controllers: [SyncController],
  providers: [BitgetSyncService, SyncSchedulerService],
  exports: [BitgetSyncService],
})
export class SyncModule {}
