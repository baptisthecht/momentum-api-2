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

  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
  @Column({ type: 'timestamptz', nullable: true }) stoppedAt: Date | null;

  @OneToMany(() => Position, (p) => p.session) positions: Position[];
  @OneToMany(() => Trade, (t) => t.session) trades: Trade[];
}
