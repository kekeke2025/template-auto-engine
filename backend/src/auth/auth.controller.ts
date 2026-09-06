import { Controller, Post, Body, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { LoginDto } from '../user/dto/login.dto';
import { RegisterDto } from '../user/dto/register.dto';
import { User } from '../user/entities/user.entity';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly jwtService: JwtService,
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  @Post('login')
  async login(@Body() loginDto: LoginDto) {
    const user = await this.userRepository.findOne({
      where: { email: loginDto.email },
    });

    if (!user) {
      throw new UnauthorizedException('邮箱或密码错误');
    }

    // 兼容旧数据（明文密码）和新数据（加密密码）
    const passwordValid = user.password.startsWith('$2')
      ? await bcrypt.compare(loginDto.password, user.password)
      : user.password === loginDto.password;

    if (!passwordValid) {
      throw new UnauthorizedException('邮箱或密码错误');
    }

    if (user.status !== 1) {
      throw new UnauthorizedException('账号已被禁用');
    }

    const payload = { sub: user.id, username: user.username };
    const token = this.jwtService.sign(payload);

    const { password, ...userInfo } = user;
    return {
      code: 200,
      message: '登录成功',
      data: {
        token,
        user: userInfo,
      },
    };
  }

  @Post('register')
  async register(@Body() registerDto: RegisterDto) {
    if (registerDto.password !== registerDto.confirmPassword) {
      throw new BadRequestException('两次输入的密码不一致');
    }

    // 检查邮箱是否已注册
    const existingUser = await this.userRepository.findOne({
      where: { email: registerDto.email },
    });
    if (existingUser) {
      throw new BadRequestException('该邮箱已注册');
    }

    // 密码加密
    const hashedPassword = await bcrypt.hash(registerDto.password, 10);

    const user = this.userRepository.create({
      email: registerDto.email,
      username: registerDto.username,
      password: hashedPassword,
      status: 1,
    });

    const savedUser = await this.userRepository.save(user);

    const payload = { sub: savedUser.id, username: savedUser.username };
    const token = this.jwtService.sign(payload);

    const { password, ...userInfo } = savedUser;
    return {
      code: 200,
      message: '注册成功',
      data: {
        token,
        user: userInfo,
      },
    };
  }
}
