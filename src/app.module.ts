import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';

import { AuthModule } from './auth/auth.module';
import { UserModule } from './user/user.module';
import { StrategyModule } from './strategy/strategy.module';
import { SessionModule } from './session/session.module';
import { BotModule } from './bot/bot.module';
import { TradeModule } from './trade/trade.module';
import { CandleModule } from './candle/candle.module';
import { PositionModule } from './position/position.module';
import { TpTargetModule } from './tp-target/tp-target.module';
import { SignalEvaluationModule } from './signal-evaluation/signal-evaluation.module';

import { User } from './user/user.entity';
import { Strategy } from './strategy/strategy.entity';
import { StrategyTpTemplate } from './strategy/strategy-tp-template.entity';
import { SymbolOverride } from './strategy/symbol-override.entity';
import { SymbolOverrideTpTemplate } from './strategy/symbol-override-tp-template.entity';
import { Session } from './session/session.entity';
import { Candle } from './candle/candle.entity';
import { Position } from './position/position.entity';
import { PositionTpTarget } from './tp-target/position-tp-target.entity';
import { Trade } from './trade/trade.entity';
import { SignalEvaluation, SignalConditionCheck } from './signal-evaluation/signal-evaluation.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot(),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (c: ConfigService) => ({
        type: 'postgres' as const,
        host: c.get('DB_HOST', 'localhost'),
        port: c.get<number>('DB_PORT', 5432),
        username: c.get('DB_USERNAME', 'momentum'),
        password: c.get('DB_PASSWORD', 'momentum_secret'),
        database: c.get('DB_NAME', 'momentum'),
        entities: [
          User, Strategy, StrategyTpTemplate, SymbolOverride, SymbolOverrideTpTemplate,
          Session, Candle, Position, PositionTpTarget, Trade,
          SignalEvaluation, SignalConditionCheck,
        ],
        synchronize: true,
        logging: c.get('NODE_ENV') === 'development',
      }),
    }),
    AuthModule, UserModule, StrategyModule, SessionModule,
    BotModule, TradeModule, CandleModule, PositionModule,
    TpTargetModule, SignalEvaluationModule,
  ],
})
export class AppModule {}
