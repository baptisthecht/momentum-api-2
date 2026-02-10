import { Controller, Get, Put, Body, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, ApiOperation } from '@nestjs/swagger';
import { UserService } from './user.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UpdateBitgetKeysDto } from './dto/update-bitget-keys.dto';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile' })
  getProfile(@CurrentUser() user: { id: string }) {
    return this.userService.getProfile(user.id);
  }

  @Put('me/bitget-keys')
  @ApiOperation({ summary: 'Update Bitget API credentials' })
  async updateKeys(
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateBitgetKeysDto,
  ) {
    await this.userService.updateBitgetCredentials(user.id, dto.apiKey, dto.apiSecret, dto.passphrase);
    return { message: 'Bitget credentials updated' };
  }
}
