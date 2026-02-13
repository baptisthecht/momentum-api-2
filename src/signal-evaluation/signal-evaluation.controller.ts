import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SignalEvaluation } from './signal-evaluation.entity';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@ApiTags('Signal Evaluations')
@ApiBearerAuth()
@Controller('signal-evaluations')
@UseGuards(JwtAuthGuard)
export class SignalEvaluationController {
  constructor(
    @InjectRepository(SignalEvaluation) private readonly evalRepo: Repository<SignalEvaluation>,
  ) {}

  @Get('session/:sessionId')
  @ApiOperation({ summary: 'Get signal evaluations for a session (most recent first)' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'result', required: false, enum: ['signal_long', 'signal_short', 'rejected', 'signals'] })
  async findBySession(
    @Param('sessionId') sessionId: string,
    @Query('limit') limit?: string,
    @Query('result') result?: string,
  ) {
    const qb = this.evalRepo
      .createQueryBuilder('e')
      .leftJoinAndSelect('e.checks', 'c')
      .leftJoinAndSelect('e.candle', 'candle')
      .where('e.sessionId = :sessionId', { sessionId })
      .orderBy('e.createdAt', 'DESC')
      .take(limit ? parseInt(limit, 10) : 50);

    if (result === 'signals') {
      qb.andWhere('e.result != :rej', { rej: 'rejected' });
    } else if (result) {
      qb.andWhere('e.result = :result', { result });
    }

    return qb.getMany();
  }

  /** Aggregated stats for a session — no limit, counts only */
  @Get('session/:sessionId/stats')
  @ApiOperation({ summary: 'Get evaluation stats for a session (total counts)' })
  async stats(@Param('sessionId') sessionId: string) {
    const rows: { result: string; cnt: string }[] = await this.evalRepo
      .createQueryBuilder('e')
      .select('e.result', 'result')
      .addSelect('COUNT(*)', 'cnt')
      .where('e.sessionId = :sessionId', { sessionId })
      .groupBy('e.result')
      .getRawMany();

    const total = rows.reduce((s, r) => s + Number(r.cnt), 0);
    const signals = rows.filter((r) => r.result !== 'rejected').reduce((s, r) => s + Number(r.cnt), 0);
    const rejected = total - signals;
    const longSignals = Number(rows.find((r) => r.result === 'signal_long')?.cnt ?? 0);
    const shortSignals = Number(rows.find((r) => r.result === 'signal_short')?.cnt ?? 0);

    return { total, signals, rejected, longSignals, shortSignals };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single signal evaluation with all condition checks' })
  findOne(@Param('id') id: string) {
    return this.evalRepo.findOne({ where: { id }, relations: ['checks', 'candle'] });
  }
}
