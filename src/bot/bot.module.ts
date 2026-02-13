import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BotService } from './bot.service';
import { BitgetClientService } from './bitget-client.service';
import { BitgetWsService } from './bitget-ws.service';
import { Session } from '../session/session.entity';
import { Candle } from '../candle/candle.entity';
import { Position } from '../position/position.entity';
import { Trade } from '../trade/trade.entity';
import { PositionTpTarget } from '../tp-target/position-tp-target.entity';
import { SignalEvaluation, SignalConditionCheck } from '../signal-evaluation/signal-evaluation.entity';
import { StrategyModule } from '../strategy/strategy.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Session, Candle, Position, Trade, PositionTpTarget,
      SignalEvaluation, SignalConditionCheck,
    ]),
    StrategyModule,
  ],
  providers: [BotService, BitgetClientService, BitgetWsService],
  exports: [BotService, BitgetClientService],
})
export class BotModule {}
