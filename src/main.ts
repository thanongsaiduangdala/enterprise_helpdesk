import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ResponseInterceptor } from './common/interceptors/response/response.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.use(helmet());
  app.setGlobalPrefix('api');

  const trustProxy = process.env.TRUST_PROXY;
  if (trustProxy) {
    const numeric = Number(trustProxy);
    app.set(
      'trust proxy',
      Number.isNaN(numeric)
        ? trustProxy === 'true'
          ? 1
          : trustProxy
        : numeric,
    );
  }

  const allowedOrigins = (
    process.env.FRONTEND_URLS || 'http://localhost:5173'
  ).split(',');
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());

  // Swagger ເປີດສະເພາະ non-production — ຫຼີກລ້ຽງການເປີດເຜີຍ API surface ໃນ production
  // (helmet ຕັ້ງ CSP ໄວ້ນຳ ຈຶ່ງເປີດໄດ້ສະບາຍໃນ dev ແຕ່ບໍ່ຄວນເປີດໃນ prod)
  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Enterprise Helpdesk API')
      .setDescription('API documentation for the helpdesk system')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api-docs', app, document);
  }

  await app.listen(3000);
}
bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
