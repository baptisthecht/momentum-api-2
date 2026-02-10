import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Candle } from './candle.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Candle])],
  exports: [TypeOrmModule],
})
export class CandleModule {}
