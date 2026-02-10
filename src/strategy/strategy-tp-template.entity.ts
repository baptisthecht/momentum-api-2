import {
  Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn,
} from 'typeorm';
import { Strategy } from './strategy.entity';

@Entity('strategy_tp_templates')
export class StrategyTpTemplate {
  @PrimaryGeneratedColumn('uuid') id: string;

  @ManyToOne(() => Strategy, (s) => s.tpTemplates, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'strategyId' })
  strategy: Strategy;

  @Column() strategyId: string;
  @Column({ type: 'int' }) sortOrder: number;
  @Column({ type: 'float' }) rMultiple: number;
  @Column({ type: 'float' }) ratio: number;
  @Column({ nullable: true }) label: string;
}
