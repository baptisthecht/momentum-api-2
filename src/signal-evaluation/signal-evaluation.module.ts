import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SignalEvaluation, SignalConditionCheck } from './signal-evaluation.entity';
import { SignalEvaluationController } from './signal-evaluation.controller';

@Module({
  imports: [TypeOrmModule.forFeature([SignalEvaluation, SignalConditionCheck])],
  controllers: [SignalEvaluationController],
  exports: [TypeOrmModule],
})
export class SignalEvaluationModule {}
