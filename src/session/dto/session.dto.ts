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

  @ApiPropertyOptional({ example: false, description: 'If true, orders are not sent to Bitget' })
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
}
