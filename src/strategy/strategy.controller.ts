import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode, HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { StrategyService } from './strategy.service';

@ApiTags('Strategies')
@ApiBearerAuth()
@Controller('strategies')
@UseGuards(JwtAuthGuard)
export class StrategyController {
  constructor(private readonly strategyService: StrategyService) { }

  @Get()
  @ApiOperation({ summary: 'List all strategies' })
  findAll() { return this.strategyService.findAll(); }

  @Get(':id')
  @ApiOperation({ summary: 'Get strategy by ID' })
  findOne(@Param('id') id: string) { return this.strategyService.findById(id); }

  @Post()
  @ApiOperation({ summary: 'Create a new strategy' })
  create(@Body() dto: any) { return this.strategyService.create(dto); }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a strategy' })
  update(@Param('id') id: string, @Body() dto: any) { return this.strategyService.update(id, dto); }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a strategy' })
  remove(@Param('id') id: string) { return this.strategyService.remove(id); }

  @Post(':id/duplicate')
  @ApiOperation({ summary: 'Duplicate a strategy' })
  duplicate(@Param('id') id: string) { return this.strategyService.duplicate(id); }
}