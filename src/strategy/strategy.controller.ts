import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { StrategyService } from './strategy.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@ApiTags('Strategies')
@ApiBearerAuth()
@Controller('strategies')
@UseGuards(JwtAuthGuard)
export class StrategyController {
  constructor(private readonly strategyService: StrategyService) {}

  @Get()
  @ApiOperation({ summary: 'List all strategies' })
  findAll() { return this.strategyService.findAll(); }

  @Get(':id')
  @ApiOperation({ summary: 'Get strategy by ID' })
  findOne(@Param('id') id: string) { return this.strategyService.findById(id); }
}
