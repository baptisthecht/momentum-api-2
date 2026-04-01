import { Body, Controller, Get, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BitgetClientService } from '../bot/bitget-client.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { UpdateBitgetKeysDto } from './dto/update-bitget-keys.dto';
import { UserService } from './user.service';

@ApiTags('Users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly bitget: BitgetClientService,
  ) { }

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

  @Patch('me/bitget-keys')
  @ApiOperation({ summary: 'Update Bitget API credentials (PATCH alias)' })
  async updateKeysPatch(
    @CurrentUser() user: { id: string },
    @Body() dto: UpdateBitgetKeysDto,
  ) {
    await this.userService.updateBitgetCredentials(user.id, dto.apiKey, dto.apiSecret, dto.passphrase);
    return { message: 'Bitget credentials updated' };
  }

  @Post('me/test-credentials')
  @ApiOperation({ summary: 'Test Bitget API credentials by fetching account info' })
  async testCredentials(@CurrentUser() user: { id: string }) {
    const u = await this.userService.findById(user.id);
    if (!u?.bitgetApiKey || !u?.bitgetApiSecret || !u?.bitgetPassphrase) {
      return { ok: false, error: 'No Bitget credentials configured' };
    }
    return this.bitget.testCredentials(u.bitgetApiKey, u.bitgetApiSecret, u.bitgetPassphrase);
  }

  @Get('me/balance')
  @ApiOperation({ summary: 'Fetch live Bitget USDT-Futures balance' })
  async getBalance(@CurrentUser() user: { id: string }) {
    const u = await this.userService.findById(user.id);
    if (!u?.bitgetApiKey || !u?.bitgetApiSecret || !u?.bitgetPassphrase) {
      return { ok: false, error: 'No Bitget credentials configured', available: null, equity: null };
    }
    try {
      const { RestClientV2 } = await import('bitget-api');
      const client = new RestClientV2({ apiKey: u.bitgetApiKey, apiSecret: u.bitgetApiSecret, apiPass: u.bitgetPassphrase });
      const resp = await client.getFuturesAccountAssets({ productType: 'USDT-FUTURES' } as any);
      const assets: any[] = Array.isArray(resp?.data) ? resp.data : [];
      const usdt = assets.find((a: any) => a.marginCoin === 'USDT' || a.coin === 'USDT') ?? assets[0];
      if (!usdt) return { ok: true, available: 0, equity: 0, unrealizedPnl: 0 };
      return {
        ok: true,
        available: parseFloat(usdt.available ?? usdt.availableAmount ?? '0'),
        equity: parseFloat(usdt.equity ?? usdt.accountEquity ?? usdt.usdtEquity ?? '0'),
        unrealizedPnl: parseFloat(usdt.unrealizedPL ?? usdt.unrealizedPNL ?? '0'),
      };
    } catch (e: any) {
      return { ok: false, error: e.message, available: null, equity: null };
    }
  }
}