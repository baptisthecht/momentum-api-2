import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');

  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  app.enableCors();

  // ── Swagger UI ──
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Momentum Trading API')
    .setDescription(
      'SaaS trading bot backend — EMA+RSI+ATR momentum strategy on Bitget futures.\n\n' +
      '**Flow:** Register → Set Bitget keys → Start session → Bot trades automatically.\n\n' +
      '**Signal Evaluations:** Every candle, every condition check is logged with expected vs actual values.',
    )
    .setVersion('2.0')
    .addBearerAuth()
    .addTag('Auth', 'Register & login')
    .addTag('Users', 'Profile & Bitget credentials')
    .addTag('Strategies', 'Trading strategy configurations')
    .addTag('Sessions', 'Start/stop trading sessions')
    .addTag('Trades', 'Closed trade history')
    .addTag('Signal Evaluations', 'Why signals were accepted or rejected')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  logger.log(`API running on http://localhost:${port}/api`);
  logger.log(`Swagger UI on http://localhost:${port}/docs`);
}

bootstrap();
