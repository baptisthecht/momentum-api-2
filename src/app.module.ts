import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { EventEmitterModule } from "@nestjs/event-emitter";
import { TypeOrmModule } from "@nestjs/typeorm";

import { AuthModule } from "./auth/auth.module";
import { BotModule } from "./bot/bot.module";
import { Candle } from "./candle/candle.entity";
import { CandleModule } from "./candle/candle.module";
import { Position } from "./position/position.entity";
import { PositionModule } from "./position/position.module";
import { Session } from "./session/session.entity";
import { SessionModule } from "./session/session.module";
import {
	SignalConditionCheck,
	SignalEvaluation,
} from "./signal-evaluation/signal-evaluation.entity";
import { SignalEvaluationModule } from "./signal-evaluation/signal-evaluation.module";
import { Strategy } from "./strategy/strategy.entity";
import { StrategyModule } from "./strategy/strategy.module";
import { StrategyTpTemplate } from "./strategy/strategy-tp-template.entity";
import { SymbolOverride } from "./strategy/symbol-override.entity";
import { SymbolOverrideTpTemplate } from "./strategy/symbol-override-tp-template.entity";
import { PositionTpTarget } from "./tp-target/position-tp-target.entity";
import { TpTargetModule } from "./tp-target/tp-target.module";
import { Trade } from "./trade/trade.entity";
import { TradeModule } from "./trade/trade.module";
import { User } from "./user/user.entity";
import { UserModule } from "./user/user.module";

@Module({
	imports: [
		ConfigModule.forRoot({ isGlobal: true }),
		EventEmitterModule.forRoot(),
		TypeOrmModule.forRootAsync({
			inject: [ConfigService],
			useFactory: (c: ConfigService) => ({
				type: "postgres" as const,
				host: c.get<string>("DB_HOST", "localhost"),
				port: c.get<number>("DB_PORT", 5432),
				username: c.get<string>("DB_USERNAME", "momentum"),
				password: c.get<string>("DB_PASSWORD", "momentum_secret"),
				database: c.get<string>("DB_NAME", "momentum"),
				entities: [
					User,
					Strategy,
					StrategyTpTemplate,
					SymbolOverride,
					SymbolOverrideTpTemplate,
					Session,
					Candle,
					Position,
					PositionTpTarget,
					Trade,
					SignalEvaluation,
					SignalConditionCheck,
				],
				synchronize: true,
				logging: c.get("NODE_ENV") === "development",
			}),
		}),
		AuthModule,
		UserModule,
		StrategyModule,
		SessionModule,
		BotModule,
		TradeModule,
		CandleModule,
		PositionModule,
		TpTargetModule,
		SignalEvaluationModule,
	],
})
export class AppModule {}
