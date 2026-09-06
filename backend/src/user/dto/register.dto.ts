import { IsEmail, IsNotEmpty, MinLength, Matches } from 'class-validator';

export class RegisterDto {
  @IsNotEmpty({ message: '用户名不能为空' })
  @MinLength(2, { message: '用户名长度不能少于2位' })
  username: string;

  @IsNotEmpty({ message: '邮箱不能为空' })
  @IsEmail({}, { message: '邮箱格式不正确' })
  email: string;

  @IsNotEmpty({ message: '密码不能为空' })
  @MinLength(6, { message: '密码长度不能少于6位' })
  @Matches(/^(?![0-9]+$)(?![a-zA-Z]+$)[0-9A-Za-z]/, {
    message: '密码必须包含字母和数字',
  })
  password: string;

  @IsNotEmpty({ message: '确认密码不能为空' })
  confirmPassword: string;
}
