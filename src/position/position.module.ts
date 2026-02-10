import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Position } from './position.entity';
@Module({ imports: [TypeOrmModule.forFeature([Position])], exports: [TypeOrmModule] })
export class PositionModule {}
