import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { User } from '../user/entities/user.entity';

@Module({
  imports: [PassportModule, TypeOrmModule.forFeature([User])],
  controllers: [AuthController],
  providers: [JwtStrategy],
  exports: [],
})
export class AuthModule {}
