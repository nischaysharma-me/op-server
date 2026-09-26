import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as session from 'express-session';
import * as path from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get(ConfigService);

  // Enable CORS
  app.enableCors({
    origin: true,
    credentials: true,
  });

  // Global API prefix to match existing /api routes
  app.setGlobalPrefix('api');

  // Serve static assets if exists
  app.useStaticAssets(path.join(__dirname, '..', 'assets'));

  // Session configuration matching legacy setup
  const sessionSecret =
    configService.get<string>('SESSIONS_SECRET') ||
    'opinions_poll_session_secret_local_dev';
  app.use(
    session({
      name: 'yor_admin_cookie',
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
    }),
  );

  // Validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidUnknownValues: false,
    }),
  );

  const port = configService.get<number>('PORT') || 4002;
  const appName = configService.get<string>('APP_NAME') || 'Opinions Poll';

  await app.listen(port);
  console.log(`${appName} is listening at http://localhost:${port}`);
}

bootstrap();
