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
  @ApiQuery({ name: 'result', required: false, enum: ['signal_long', 'signal_short', 'rejected'] })
  async findBySession(
    @Param('sessionId') sessionId: string,
    @Query('limit') limit?: string,
    @Query('result') result?: string,
  ) {
    const qb = this.evalRepo
      .createQueryBuilder('e')
      .leftJoinAndSelect('e.checks', 'c')
      .where('e.sessionId = :sessionId', { sessionId })
      .orderBy('e.createdAt', 'DESC')
      .take(limit ? parseInt(limit, 10) : 50);

    if (result) qb.andWhere('e.result = :result', { result });

    return qb.getMany();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single signal evaluation with all condition checks' })
  findOne(@Param('id') id: string) {
    return this.evalRepo.findOne({ where: { id }, relations: ['checks'] });
  }
}
