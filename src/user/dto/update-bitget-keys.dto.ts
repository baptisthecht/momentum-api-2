import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class UpdateBitgetKeysDto {
  @ApiProperty() @IsString() @IsNotEmpty()
  apiKey: string;

  @ApiProperty() @IsString() @IsNotEmpty()
  apiSecret: string;

  @ApiProperty() @IsString() @IsNotEmpty()
  passphrase: string;
}
