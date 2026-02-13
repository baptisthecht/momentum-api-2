import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Trade } from './trade.entity';
import { Position } from '../position/position.entity';
import { PositionTpTarget } from '../tp-target/position-tp-target.entity';
import { TradeController } from './trade.controller';
@Module({ imports: [TypeOrmModule.forFeature([Trade, Position, PositionTpTarget])], controllers: [TradeController], exports: [TypeOrmModule] })
export class TradeModule {}
