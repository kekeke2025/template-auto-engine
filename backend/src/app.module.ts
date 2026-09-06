import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { TemplateModule } from './template/template.module';
import { User } from './user/entities/user.entity';
import { Template } from './template/entities/template.entity';
import { TemplateFavorite } from './template/entities/template-favorite.entity';
import { GenerateRecord } from './template/entities/generate-record.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'mysql',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '3306'),
      username: process.env.DB_USERNAME || 'root',
      password: process.env.DB_PASSWORD || '123456',
      database: process.env.DB_DATABASE || 'psd_template',
      entities: [User, Template, TemplateFavorite, GenerateRecord],
      synchronize: true,
      logging: false,
      charset: 'utf8mb4',
    }),
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET || 'psd-template-secret',
      signOptions: { expiresIn: '7d' },
    }),
    AuthModule,
    TemplateModule,
  ],
})
export class AppModule {}
