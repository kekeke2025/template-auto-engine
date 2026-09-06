import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET || 'psd-template-secret',
    });
  }

  async validate(payload: any) {
    // 模拟验证，直接返回用户信息，不用查数据库
    return {
      id: payload.sub,
      username: payload.username,
      status: 1
    }
  }
}
