import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
  ) {}

  findByEmail(email: string) {
    return this.repo.findOne({ where: { email } });
  }

  findById(id: string) {
    return this.repo.findOne({ where: { id } });
  }

  create(data: { email: string; passwordHash: string; displayName?: string }) {
    return this.repo.save(this.repo.create(data));
  }

  async updateBitgetCredentials(
    userId: string, apiKey: string, apiSecret: string, passphrase: string,
  ) {
    await this.repo.update(userId, { bitgetApiKey: apiKey, bitgetApiSecret: apiSecret, bitgetPassphrase: passphrase });
  }

  async getProfile(userId: string) {
    const u = await this.findById(userId);
    if (!u) return null;
    return {
      id: u.id, email: u.email, displayName: u.displayName,
      hasBitgetKeys: !!(u.bitgetApiKey && u.bitgetApiSecret),
      createdAt: u.createdAt,
    };
  }
}
