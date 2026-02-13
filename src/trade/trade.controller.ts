import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Trade } from './trade.entity';
import { Position } from '../position/position.entity';
import { PositionTpTarget } from '../tp-target/position-tp-target.entity';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@ApiTags('Trades')
@ApiBearerAuth()
@Controller('trades')
@UseGuards(JwtAuthGuard)
export class TradeController {
  constructor(
    @InjectRepository(Trade) private readonly tradeRepo: Repository<Trade>,
    @InjectRepository(Position) private readonly posRepo: Repository<Position>,
    @InjectRepository(PositionTpTarget) private readonly tpRepo: Repository<PositionTpTarget>,
  ) {}

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

  /** Positions with aggregated trades P&L */
  @Get('session/:sessionId/positions')
  @ApiOperation({ summary: 'Get positions with their trades and aggregated P&L' })
  async positionsWithPnl(@Param('sessionId') sessionId: string) {
    const positions = await this.posRepo.find({
      where: { sessionId },
      order: { openTime: 'DESC' },
    });

    const posIds = positions.map((p) => p.id);
    if (posIds.length === 0) return [];

    const trades = await this.tradeRepo.find({ where: { sessionId }, order: { closeTime: 'ASC' } });
    const targets = await this.tpRepo
      .createQueryBuilder('t')
      .where('t.positionId IN (:...ids)', { ids: posIds })
      .orderBy('t.sortOrder', 'ASC')
      .getMany();

    return positions.map((p) => {
      const posTrades = trades.filter((t) => t.positionId === p.id);
      const totalPnl = posTrades.reduce((s, t) => s + t.pnl, 0);
      const totalFees = posTrades.reduce((s, t) => s + t.fees, 0);
      const posTpTargets = targets.filter((t) => t.positionId === p.id);
      return {
        ...p,
        tpTargets: posTpTargets,
        trades: posTrades,
        totalPnl,
        totalFees,
        netPnl: totalPnl,
        tradeCount: posTrades.length,
        isWin: totalPnl > 0,
      };
    });
  }
}
