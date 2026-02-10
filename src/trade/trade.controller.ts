import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Trade } from './trade.entity';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@ApiTags('Trades')
@ApiBearerAuth()
@Controller('trades')
@UseGuards(JwtAuthGuard)
export class TradeController {
  constructor(@InjectRepository(Trade) private readonly tradeRepo: Repository<Trade>) {}

  @Get('session/:sessionId')
  @ApiOperation({ summary: 'Get trade history for a session' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  findBySession(@Param('sessionId') sessionId: string, @Query('limit') limit?: string) {
    return this.tradeRepo.find({
      where: { sessionId },
      order: { closeTime: 'DESC' },
      take: limit ? parseInt(limit, 10) : 100,
    });
  }
}
