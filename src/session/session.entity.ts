import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, ManyToOne, OneToMany, JoinColumn,
} from 'typeorm';
import { User } from '../user/user.entity';
import { Strategy } from '../strategy/strategy.entity';
import { Position } from '../position/position.entity';
import { Trade } from '../trade/trade.entity';

export enum SessionStatus {
  RUNNING = 'running',
  STOPPED = 'stopped',
}

@Entity('sessions')
export class Session {
  @PrimaryGeneratedColumn('uuid') id: string;

  @ManyToOne(() => User, (u) => u.sessions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column() userId: string;

  @ManyToOne(() => Strategy, (s) => s.sessions)
  @JoinColumn({ name: 'strategyId' })
  strategy: Strategy;

  @Column() strategyId: string;
  @Column() symbol: string;
  @Column({ default: 35 }) leverage: number;
  @Column({ type: 'enum', enum: SessionStatus, default: SessionStatus.RUNNING }) status: SessionStatus;
  @Column({ default: false }) simulation: boolean;
  @Column({ type: 'float', default: 1000 }) startingBalance: number;
  @Column({ type: 'float', default: 1000 }) currentBalance: number;
  @Column({ type: 'float', default: 1000 }) currentEquity: number;

  // Per-session risk overrides (nullable = use strategy defaults)
  @Column({ type: 'float', nullable: true }) riskPerTradePct: number | null;
  @Column({ type: 'float', nullable: true }) maxNotionalUsdt: number | null;
  @Column({ type: 'float', nullable: true }) minProfitUsdt: number | null;
  @Column({ type: 'int', nullable: true }) maxOpenPositions: number | null;

  // MOM-15: absolute USDT cap on risk per trade
  @Column({ type: 'float', nullable: true }) maxRiskPerTradeUsdt: number | null;

  // MOM-16: fraction of equity allocated to this session/symbol
  @Column({ type: 'float', nullable: true }) capitalFraction: number | null;

  // MOM-17-21: RiskManager state — persisted so kill switch survives restarts
  @Column({ type: 'float', default: 0 }) dailyPnl: number;
  @Column({ type: 'int', default: 0 }) tradesToday: number;
  @Column({ type: 'int', default: 0 }) consecutiveLosses: number;
  @Column({ default: false }) killSwitchTriggered: boolean;
  @Column({ type: 'float', default: 1.0 }) riskMultiplier: number;
  @Column({ type: 'int', default: 0 }) recoveryCounter: number;
  @Column({ type: 'timestamptz', nullable: true }) riskDayStartedAt: Date | null;
  @Column({ type: 'float', nullable: true }) riskDayStartingEquity: number | null;

  // MOM-17-21: RiskManager config overrides (nullable = disabled)
  @Column({ type: 'float', nullable: true }) maxDailyLossPct: number | null;
  @Column({ type: 'float', nullable: true }) maxDailyLossUsdt: number | null;
  @Column({ type: 'int', nullable: true }) maxTradesPerDay: number | null;
  @Column({ type: 'int', nullable: true }) maxConsecutiveLosses: number | null;
  @Column({ type: 'int', nullable: true }) drawdownAutoReduceAfter: number | null;
  @Column({ type: 'float', nullable: true }) drawdownAutoReduceFactor: number | null;
  @Column({ type: 'int', nullable: true }) drawdownRecoveryTrades: number | null;

  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) stoppedAt: Date | null;

  @OneToMany(() => Position, (p) => p.session) positions: Position[];
  @OneToMany(() => Trade, (t) => t.session) trades: Trade[];
}
