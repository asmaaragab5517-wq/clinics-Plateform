import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/** OpenAPI 3 document for /v1 (NFR-9). Request bodies are validated with zod schemas from @hf/shared. */
export function openApiDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('HealthFlow Clinics API')
    .setDescription('REST API for the HealthFlow Clinics platform. Staff: Keycloak bearer tokens. Patients: OTP-issued bearer tokens. Public routes require the x-org header.')
    .setVersion('1.0.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', in: 'header', name: 'x-org' }, 'org')
    .build();
  return SwaggerModule.createDocument(app, config);
}
