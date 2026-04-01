import {
  Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, Index,
} from 'typeorm';
import { Position } from '../position/position.entity';

@Entity('position_tp_targets')
@Index(['positionId', 'sortOrder'], { unique: true })
export class PositionTpTarget {
  @PrimaryGeneratedColumn('uuid') id: string;

  @ManyToOne(() => Position, (p) => p.tpTargets, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'positionId' })
  position: Position;

  @Column() positionId: string;
  @Column({ type: 'int' }) sortOrder: number;
  @Column({ type: 'float' }) price: number;
  @Column({ type: 'float' }) ratio: number;
  @Column({ type: 'float' }) targetQty: number;
  @Column({ type: 'float', default: 0 }) filledQty: number;
  @Column({ default: false }) hit: boolean;
  @Column({ nullable: true }) label: string;
}
