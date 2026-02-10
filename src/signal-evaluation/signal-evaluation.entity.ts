import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
  ManyToOne, JoinColumn, OneToMany, Index,
} from 'typeorm';
import { Session } from '../session/session.entity';
import { Candle } from '../candle/candle.entity';

export enum EvaluationResult {
  SIGNAL_LONG = 'signal_long',
  SIGNAL_SHORT = 'signal_short',
  REJECTED = 'rejected',
}

@Entity('signal_evaluations')
@Index(['sessionId', 'candleId'])
export class SignalEvaluation {
  @PrimaryGeneratedColumn('uuid') id: string;

  @ManyToOne(() => Session, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sessionId' })
  session: Session;

  @Column() sessionId: string;

  @ManyToOne(() => Candle, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'candleId' })
  candle: Candle;

  @Column() candleId: string;
  @Column() symbol: string;
  @Column({ type: 'enum', enum: EvaluationResult }) result: EvaluationResult;

  // Market snapshot
  @Column({ type: 'float' }) closePrice: number;
  @Column({ type: 'float' }) rsiValue: number;
  @Column({ type: 'float' }) atrValue: number;
  @Column({ type: 'float' }) emaFastValue: number;
  @Column({ type: 'float' }) emaSlowValue: number;

  @OneToMany(() => SignalConditionCheck, (c) => c.evaluation, { cascade: true })
  checks: SignalConditionCheck[];

  @CreateDateColumn() createdAt: Date;
}

/**
 * Each condition checked during signal evaluation.
 * Stores WHAT was checked, WHAT was expected, WHAT was actual, and if it PASSED.
 *
 * Example: conditionName="rsi_oversold" expected="≤32" actual="45.20" passed=false
 */
@Entity('signal_condition_checks')
@Index(['evaluationId'])
export class SignalConditionCheck {
  @PrimaryGeneratedColumn('uuid') id: string;

  @ManyToOne(() => SignalEvaluation, (e) => e.checks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'evaluationId' })
  evaluation: SignalEvaluation;

  @Column() evaluationId: string;
  @Column() side: string;
  @Column() conditionName: string;
  @Column() expectedValue: string;
  @Column() actualValue: string;
  @Column() passed: boolean;
}
