import {
  Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn,
} from 'typeorm';
import { SymbolOverride } from './symbol-override.entity';

@Entity('symbol_override_tp_templates')
export class SymbolOverrideTpTemplate {
  @PrimaryGeneratedColumn('uuid') id: string;

  @ManyToOne(() => SymbolOverride, (o) => o.tpTemplates, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'symbolOverrideId' })
  symbolOverride: SymbolOverride;

  @Column() symbolOverrideId: string;
  @Column({ type: 'int' }) sortOrder: number;
  @Column({ type: 'float' }) rMultiple: number;
  @Column({ type: 'float' }) ratio: number;
  @Column({ nullable: true }) label: string;
}
