import {
  Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn,
} from 'typeorm';

@Entity('candles')
@Index(['symbol', 'granularity', 'openTime'], { unique: true })
export class Candle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  symbol: string;

  @Column({ default: '5m' })
  granularity: string;

  @Column({ type: 'timestamptz' })
  openTime: Date;

  @Column({ type: 'float' }) open: number;
  @Column({ type: 'float' }) high: number;
  @Column({ type: 'float' }) low: number;
  @Column({ type: 'float' }) close: number;
  @Column({ type: 'float' }) volume: number;

  @CreateDateColumn()
  createdAt: Date;
}
