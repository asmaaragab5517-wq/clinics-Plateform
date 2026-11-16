/** Entry point shared with the background worker (apps/worker). */
export { CoreModule, coreProviders } from './app.module';
export { loadConfig, CONFIG, type Config } from './config';
export { Tenancy, AuditService, DB } from './common/services';
export { MessagingService } from './modules/messaging.service';
export { AppointmentsService } from './modules/appointments.service';
export { AvailabilityService } from './modules/availability.service';
export { PaymentsService } from './modules/payments';
export { ReportsController } from './modules/reports';
export { generateCommissionStatements } from './modules/staff';
