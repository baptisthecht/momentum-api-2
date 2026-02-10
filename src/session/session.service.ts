import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Session, SessionStatus } from './session.entity';
import { StrategyService } from '../strategy/strategy.service';
import { StartSessionDto } from './dto/session.dto';

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    @InjectRepository(Session) private readonly sessionRepo: Repository<Session>,
    private readonly strategyService: StrategyService,
  ) {}

  async start(userId: string, dto: StartSessionDto): Promise<Session> {
    let strategy;
    if (dto.strategyId) {
      strategy = await this.strategyService.findById(dto.strategyId);
      if (!strategy) throw new NotFoundException('Strategy not found');
    } else {
      strategy = await this.strategyService.findDefault();
      if (!strategy) throw new BadRequestException('No default strategy available');
    }

    const balance = dto.startingBalance ?? 1000;
    const session = this.sessionRepo.create({
      userId,
      strategyId: strategy.id,
      symbol: dto.symbol.toUpperCase(),
      leverage: dto.leverage ?? 35,
      simulation: dto.simulation ?? false,
      startingBalance: balance,
      currentBalance: balance,
      currentEquity: balance,
      riskPerTradePct: dto.riskPerTradePct ?? null,
      maxNotionalUsdt: dto.maxNotionalUsdt ?? null,
      minProfitUsdt: dto.minProfitUsdt ?? null,
      status: SessionStatus.RUNNING,
    });

    const saved = await this.sessionRepo.save(session);
    this.logger.log(`Session started: ${saved.id} (${saved.symbol}, user=${userId})`);
    return saved;
  }

  async stop(sessionId: string, userId: string): Promise<Session> {
    const session = await this.sessionRepo.findOne({ where: { id: sessionId, userId } });
    if (!session) throw new NotFoundException('Session not found');
    if (session.status === SessionStatus.STOPPED) throw new BadRequestException('Already stopped');
    session.status = SessionStatus.STOPPED;
    session.stoppedAt = new Date();
    return this.sessionRepo.save(session);
  }

  findByUser(userId: string) {
    return this.sessionRepo.find({ where: { userId }, relations: ['strategy'], order: { createdAt: 'DESC' } });
  }

  findById(sessionId: string, userId: string) {
    return this.sessionRepo.findOne({ where: { id: sessionId, userId }, relations: ['strategy', 'positions', 'trades'] });
  }

  findRunning(userId: string) {
    return this.sessionRepo.find({ where: { userId, status: SessionStatus.RUNNING }, relations: ['strategy'] });
  }
}
