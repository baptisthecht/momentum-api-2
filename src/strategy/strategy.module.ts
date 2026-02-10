import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Strategy } from './strategy.entity';
import { StrategyTpTemplate } from './strategy-tp-template.entity';
import { SymbolOverride } from './symbol-override.entity';
import { SymbolOverrideTpTemplate } from './symbol-override-tp-template.entity';
import { StrategyService } from './strategy.service';
import { StrategyController } from './strategy.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Strategy, StrategyTpTemplate, SymbolOverride, SymbolOverrideTpTemplate])],
  controllers: [StrategyController],
  providers: [StrategyService],
  exports: [StrategyService, TypeOrmModule],
})
export class StrategyModule {}
