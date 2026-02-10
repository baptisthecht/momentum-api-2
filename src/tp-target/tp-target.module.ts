import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PositionTpTarget } from './position-tp-target.entity';
@Module({ imports: [TypeOrmModule.forFeature([PositionTpTarget])], exports: [TypeOrmModule] })
export class TpTargetModule {}
