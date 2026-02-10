import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, OneToMany,
} from 'typeorm';
import { Session } from '../session/session.entity';
import { PositionTpTarget } from '../tp-target/position-tp-target.entity';

export enum OrderSide {
  LONG = 'long',
  SHORT = 'short',
}

@Entity('positions')
export class Position {
  @PrimaryGeneratedColumn('uuid') id: string;

  @ManyToOne(() => Session, (s) => s.positions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sessionId' })
  session: Session;

  @Column() sessionId: string;
  @Column() symbol: string;
  @Column({ type: 'enum', enum: OrderSide }) side: OrderSide;
  @Column({ type: 'float' }) qty: number;
  @Column({ type: 'float' }) originalQty: number;
  @Column({ type: 'float' }) entryPrice: number;
  @Column({ type: 'float' }) sl: number;
  @Column({ type: 'float' }) tp: number;
  @Column({ type: 'int' }) leverage: number;
  @Column({ type: 'timestamptz' }) openTime: Date;
  @Column({ default: false }) isClosed: boolean;
  @Column({ type: 'float', nullable: true }) trailAtrMult: number | null;
  @Column({ type: 'float', nullable: true }) atrValue: number | null;
  @Column({ type: 'float', nullable: true }) rMultiple: number | null;
  @Column({ default: false }) trailingActive: boolean;
  @Column({ type: 'float', nullable: true }) trailingOffset: number | null;
  @Column({ type: 'float', default: 0 }) bestPrice: number;
  @Column({ type: 'float', default: 0 }) entryFeeTotal: number;
  @Column({ type: 'float', default: 0 }) entryFeeRemaining: number;
  @Column({ type: 'float', default: 0 }) realizedFees: number;
  @Column({ type: 'float', default: 0 }) riskAmount: number;
  @Column({ type: 'float', default: 0 }) riskAmountRemaining: number;

  @OneToMany(() => PositionTpTarget, (t) => t.position, { cascade: true })
  tpTargets: PositionTpTarget[];

  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
