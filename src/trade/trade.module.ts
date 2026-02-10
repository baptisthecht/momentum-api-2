import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Trade } from './trade.entity';
import { TradeController } from './trade.controller';
@Module({ imports: [TypeOrmModule.forFeature([Trade])], controllers: [TradeController], exports: [TypeOrmModule] })
export class TradeModule {}
