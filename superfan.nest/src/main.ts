const path = require('path');
require('dotenv').config({ path: '/etc/secrets/.env' });
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
require('dotenv').config();
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as handlebars from 'handlebars';
import helmet from 'helmet';
import { PostHog } from 'posthog-node';
import { PostHogInterceptor } from 'posthog-node/nestjs';
import 'reflect-metadata';
import { AppModule } from './app.module';
import './instrument';


// Global Node.js error handlers
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
  });

  const configService = app.get(ConfigService);

  app.use(helmet());

  app.enableCors({
    origin: ["http://localhost:9090", "http://localhost:9050", "https://api.superfan.ng", "https://superfan-admin.vercel.app", "https://superfan-client.vercel.app", "https://sn1.superfan.ng", "https://sg1.superfan.ng", "https://sa1.superfan.ng"],
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
    preflightContinue: false,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

   const posthog = new PostHog('phc_ho5i18afMJlHWN1xrQypW9MxdlAKBaVIxu5wXudt6uB', {
    host: 'https://us.i.posthog.com',
  })

  // new ClassSerializerInterceptor(app.get(Reflector))
  app.useGlobalInterceptors(
    new PostHogInterceptor(posthog, {
    captureExceptions: { minStatusToCapture: 400 },
  })
  );

  // Register handlebars helper
  handlebars.registerHelper('substring', (str: string, start: number, end: number) => {
    if (typeof str === 'string') {
      return str.substring(start, end);
    }
    return '';
  });

  // Swagger
  const config = new DocumentBuilder()
    .setTitle('Superfan API')
    .setDescription('Minimal reproduction of Superfan API')
    .setVersion('0.1')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  // Start microservice listeners before HTTP
  await app.startAllMicroservices();

  const server = await app.listen(configService.get('PORT') ?? 3000);

  // HTTP server error handlers
  server.on('error', (err) => {
    console.error('HTTP Server error:', err);
  });

  server.on('clientError', (err: any, socket: any) => {
    console.error('Client error:', err.message, socket.remoteAddress);
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });
}

bootstrap();