import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { SessionService } from './session.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { StartSessionDto } from './dto/session.dto';

@ApiTags('Sessions')
@ApiBearerAuth()
@Controller('sessions')
@UseGuards(JwtAuthGuard)
export class SessionController {
  constructor(private readonly sessionService: SessionService) {}

  @Get()
  @ApiOperation({ summary: 'List all sessions for the current user' })
  findAll(@CurrentUser() user: { id: string }) { return this.sessionService.findByUser(user.id); }

  @Get('running')
  @ApiOperation({ summary: 'List running sessions' })
  findRunning(@CurrentUser() user: { id: string }) { return this.sessionService.findRunning(user.id); }

  @Get(':id')
  @ApiOperation({ summary: 'Get session detail with positions & trades' })
  findOne(@CurrentUser() user: { id: string }, @Param('id') id: string) { return this.sessionService.findById(id, user.id); }

  @Post('start')
  @ApiOperation({ summary: 'Start a new trading session' })
  start(@CurrentUser() user: { id: string }, @Body() dto: StartSessionDto) { return this.sessionService.start(user.id, dto); }

  @Post(':id/stop')
  @ApiOperation({ summary: 'Stop a running session' })
  stop(@CurrentUser() user: { id: string }, @Param('id') id: string) { return this.sessionService.stop(id, user.id); }
}
