import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivitiesModule } from './activities/activities.module';
import { AppealsModule } from './appeals/appeals.module';
import { AttendancesModule } from './attendances/attendances.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CommonModule } from './common/common.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { AppConfigModule, APP_ENV } from './config/app-config.module';
import { AppEnv } from './config/env';
import { buildDbOptions } from './database/data-source';
import { DuesModule } from './dues/dues.module';
import { EventsModule } from './events/events.module';
import { HealthController } from './health.controller';
import { PublicModule } from './public/public.module';
import { ReportsModule } from './reports/reports.module';
import { SettingsModule } from './settings/settings.module';
import { StudentsModule } from './students/students.module';
import { UnitsModule } from './units/units.module';
import { UsersModule } from './users/users.module';
import { RetentionModule } from './retention/retention.module';

@Module({
  imports: [
    AppConfigModule,
    TypeOrmModule.forRootAsync({ inject: [APP_ENV], useFactory: (env: AppEnv) => buildDbOptions(env) }),
    ThrottlerModule.forRootAsync({
      inject: [APP_ENV],
      // gioi han chung chi chong DDoS (dac ta 8.4); gioi han dang nhap dat rieng o AuthController
      useFactory: (env: AppEnv) => [{ ttl: 60_000, limit: env.globalRateLimitPerMin }],
    }),
    CommonModule,
    AuditModule,
    RetentionModule,
    AuthModule,
    UnitsModule,
    UsersModule,
    SettingsModule,
    EventsModule,
    PublicModule,
    AttendancesModule,
    AppealsModule,
    ActivitiesModule,
    StudentsModule,
    DuesModule,
    ReportsModule,
    DashboardModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
