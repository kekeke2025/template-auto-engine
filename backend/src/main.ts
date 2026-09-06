import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false, // 禁用默认 body parser，手动设置更大的限制
  });
  
  // 手动设置 body parser，提高请求体大小限制
  // 全量渲染模式需要传所有图层图片的 base64，可能很大
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const bodyParser = require('body-parser');
  app.use(bodyParser.json({ limit: '200mb' }));
  app.use(bodyParser.urlencoded({ limit: '200mb', extended: true }));
  
  app.enableCors({
    origin: true,
    credentials: true,
  });
  
  app.useGlobalPipes(new ValidationPipe({
    transform: true,
    whitelist: true,
  }));
  
  app.useGlobalFilters(new AllExceptionsFilter());
  
  app.setGlobalPrefix('api');

  // 静态文件服务 - 上传的文件
  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads/',
  });
  
  const port = process.env.PORT || 3002;
  await app.listen(port);
  console.log(`Backend server is running on http://localhost:${port}`);
}
bootstrap();
