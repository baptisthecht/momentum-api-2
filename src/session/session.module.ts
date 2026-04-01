import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Session } from "./session.entity";
import { SessionService } from "./session.service";
import { SessionController } from "./session.controller";
import { StrategyModule } from "../strategy/strategy.module";
import { BotModule } from "../bot/bot.module";
import { UserModule } from "../user/user.module";
import { SyncModule } from "../sync/sync.module";
import { Position } from "../position/position.entity";
import { Trade } from "../trade/trade.entity";

@Module({
	imports: [
		TypeOrmModule.forFeature([Session, Position, Trade]),
		StrategyModule,
		BotModule,
		UserModule,
		SyncModule,
	],
	controllers: [SessionController],
	providers: [SessionService],
	exports: [SessionService],
})
export class SessionModule {}
