import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean, IsNumber, IsUUID } from 'class-validator';

export class StartSessionDto {
  @ApiProperty({ example: 'BTCUSDT' })
  @IsString()
  symbol: string;

  @ApiPropertyOptional({ description: 'Strategy ID (defaults to the default strategy)' })
  @IsOptional() @IsUUID()
  strategyId?: string;

  @ApiPropertyOptional({ example: 35 })
  @IsOptional() @IsNumber()
  leverage?: number;

  @ApiPropertyOptional({ example: false })
  @IsOptional() @IsBoolean()
  simulation?: boolean;

  @ApiPropertyOptional({ example: 1000 })
  @IsOptional() @IsNumber()
  startingBalance?: number;

  @ApiPropertyOptional({ example: 0.10 })
  @IsOptional() @IsNumber()
  riskPerTradePct?: number;

  @ApiPropertyOptional({ example: 1000 })
  @IsOptional() @IsNumber()
  maxNotionalUsdt?: number;

  @ApiPropertyOptional({ example: 4.0 })
  @IsOptional() @IsNumber()
  minProfitUsdt?: number;

  // MOM-15: absolute USDT cap on risk per trade
  @ApiPropertyOptional({ example: 50, description: 'Max risk per trade in USDT (0 = disabled)' })
  @IsOptional() @IsNumber()
  maxRiskPerTradeUsdt?: number;

  // MOM-16: fraction of equity allocated to this session
  @ApiPropertyOptional({ example: 1.0, description: 'Fraction of equity to use (0-1), e.g. 0.5 = 50%' })
  @IsOptional() @IsNumber()
  capitalFraction?: number;

  // MOM-17-21: risk manager config
  @ApiPropertyOptional({ example: 3.0, description: 'Max daily loss in % before kill switch' })
  @IsOptional() @IsNumber()
  maxDailyLossPct?: number;

  @ApiPropertyOptional({ example: 60, description: 'Max daily loss in USDT before kill switch' })
  @IsOptional() @IsNumber()
  maxDailyLossUsdt?: number;

  @ApiPropertyOptional({ example: 20, description: 'Max trades per day' })
  @IsOptional() @IsNumber()
  maxTradesPerDay?: number;

  @ApiPropertyOptional({ example: 4, description: 'Max consecutive losses before blocking' })
  @IsOptional() @IsNumber()
  maxConsecutiveLosses?: number;

  @ApiPropertyOptional({ example: 3, description: 'Nb consecutive losses before auto-reducing risk' })
  @IsOptional() @IsNumber()
  drawdownAutoReduceAfter?: number;

  @ApiPropertyOptional({ example: 0.5, description: 'Risk multiplier after drawdown (0-1)' })
  @IsOptional() @IsNumber()
  drawdownAutoReduceFactor?: number;

  @ApiPropertyOptional({ example: 1, description: 'Nb winning trades to recover full risk' })
  @IsOptional() @IsNumber()
  drawdownRecoveryTrades?: number;
}
