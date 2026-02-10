import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { Session } from '../session/session.entity';
import { OrderSide } from '../position/position.entity';

@Entity('trades')
export class Trade {
  @PrimaryGeneratedColumn('uuid') id: string;

  @ManyToOne(() => Session, (s) => s.trades, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sessionId' })
  session: Session;

  @Column() sessionId: string;
  @Column() positionId: string;
  @Column() symbol: string;
  @Column({ type: 'enum', enum: OrderSide }) side: OrderSide;
  @Column({ type: 'float' }) entryPrice: number;
  @Column({ type: 'float' }) exitPrice: number;
  @Column({ type: 'float' }) qty: number;
  @Column({ type: 'int' }) leverage: number;
  @Column({ type: 'float' }) sl: number;
  @Column({ type: 'float' }) tp: number;
  @Column({ type: 'float' }) pnl: number;
  @Column({ type: 'float' }) pnlPct: number;
  @Column({ type: 'float', default: 0 }) fees: number;
  @Column({ type: 'float', default: 0 }) riskAmount: number;
  @Column({ type: 'timestamptz' }) openTime: Date;
  @Column({ type: 'timestamptz', nullable: true }) closeTime: Date;
  @Column({ nullable: true }) reason: string;
  @Column({ default: false }) isPartial: boolean;

  @CreateDateColumn() createdAt: Date;
}
