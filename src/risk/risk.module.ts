import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RiskManagerService } from './risk-manager.service';
import { Session } from '../session/session.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Session])],
  providers: [RiskManagerService],
  exports: [RiskManagerService],
})
export class RiskModule {}
