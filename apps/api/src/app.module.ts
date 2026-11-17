import { Module, type DynamicModule, type Provider } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { CONFIG, loadConfig, type Config } from './config';
import { AuthGuard } from './common/auth.guard';
import { AllExceptionsFilter } from './common/errors';
import { AuditService, Tenancy, dbProviders } from './common/services';
import { TokenService } from './common/tokens';
import { RateLimiter } from './common/rate-limit';
import { EventBus } from './integrations/events';
import { FakeHealthPayClient, HEALTHPAY, HttpHealthPayClient } from './integrations/healthpay';
import { FakeIdentityAdmin, IDENTITY_ADMIN, KeycloakAdmin } from './integrations/keycloak';
import { CHANNELS, CequensProvider, FakeProvider, FcmProvider, SmtpProvider } from './integrations/messaging';
import { ANTIVIRUS, ClamdAntivirus, DevAntivirus, MemoryStorage, S3Storage, STORAGE } from './integrations/storage';
import { AppointmentsController } from './modules/appointments';
import { AppointmentsService } from './modules/appointments.service';
import { AuthController, AuthService } from './modules/auth';
import { AvailabilityService } from './modules/availability.service';
import { BillingController } from './modules/billing';
import { BillingService } from './modules/billing.service';
import { CatalogueController } from './modules/catalogue';
import { CommsController } from './modules/comms';
import { DevController, HealthController } from './modules/dev';
import { EmrController } from './modules/emr';
import { GovernanceController } from './modules/governance';
import { ImportsController } from './modules/imports';
import { MessagingService } from './modules/messaging.service';
import { OrgController } from './modules/org';
import { PatientsController } from './modules/patients';
import { PatientsService } from './modules/patients.service';
import { PaymentsController, PaymentsService } from './modules/payments';
import { PortalController } from './modules/portal';
import { PrescriptionRenderer, PrescriptionsController } from './modules/prescriptions';
import { PublicController } from './modules/public';
import { ReportsController } from './modules/reports';
import { SchedulesController } from './modules/schedules';
import { StaffController } from './modules/staff';

export const CONTROLLERS = [
  HealthController, AuthController, OrgController, CatalogueController, StaffController, SchedulesController, AppointmentsController, PatientsController,
  EmrController, PrescriptionsController, BillingController, PaymentsController, CommsController, PublicController, PortalController, ReportsController,
  GovernanceController, ImportsController, DevController,
];

/** Domain services shared by the API and the worker. */
export function coreProviders(cfg: Config): Provider[] {
  const fake = new FakeProvider();
  return [
    { provide: CONFIG, useValue: cfg },
    ...dbProviders(),
    Tenancy,
    AuditService,
    RateLimiter,
    TokenService,
    EventBus,
    { provide: HEALTHPAY, useClass: cfg.HEALTHPAY_MODE === 'http' ? HttpHealthPayClient : FakeHealthPayClient },
    { provide: IDENTITY_ADMIN, useClass: cfg.KEYCLOAK_ISSUER && process.env.KEYCLOAK_ADMIN_CLIENT_ID ? KeycloakAdmin : FakeIdentityAdmin },
    { provide: STORAGE, useClass: cfg.STORAGE_MODE === 's3' ? S3Storage : MemoryStorage },
    { provide: ANTIVIRUS, useClass: cfg.AV_MODE === 'clamd' ? ClamdAntivirus : DevAntivirus },
    {
      provide: CHANNELS,
      useFactory: () => {
        const cequens = cfg.CEQUENS_MODE === 'http' ? new CequensProvider(cfg) : fake;
        return { sms: cequens, whatsapp: cequens, email: cfg.SMTP_URL ? new SmtpProvider(cfg) : fake, push: cfg.FCM_SERVICE_ACCOUNT_JSON ? new FcmProvider(cfg) : fake };
      },
    },
    MessagingService,
    AvailabilityService,
    AppointmentsService,
    PatientsService,
    BillingService,
    PaymentsService,
    PrescriptionRenderer,
  ];
}

@Module({})
export class AppModule {
  static forRoot(cfg: Config = loadConfig()): DynamicModule {
    if (cfg.CHROMIUM_PATH) process.env.CHROMIUM_PATH = cfg.CHROMIUM_PATH;
    return {
      module: AppModule,
      controllers: CONTROLLERS,
      providers: [...coreProviders(cfg), AuthService, { provide: APP_GUARD, useClass: AuthGuard }, { provide: APP_FILTER, useClass: AllExceptionsFilter }],
      exports: [],
    };
  }
}

@Module({})
export class CoreModule {
  static forRoot(cfg: Config = loadConfig()): DynamicModule {
    const providers = coreProviders(cfg);
    return { module: CoreModule, providers, exports: providers.map((p) => ((p as { provide?: unknown }).provide ?? p) as never) };
  }
}
