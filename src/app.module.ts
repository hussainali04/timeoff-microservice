import { Module } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { Balance } from './balances/balance.entity';
import { TimeOffRequest } from './requests/request.entity';
import { AuditLog } from './audit/audit-log.entity';
import { BalancesModule } from './balances/balances.module';
import { RequestsModule } from './requests/requests.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { HcmModule } from './hcm/hcm.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 100,
      },
    ]),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRoot({
      type: 'sqlite',
      database: process.env.DB_PATH ?? './database.sqlite',
      entities: [Balance, TimeOffRequest, AuditLog],
      synchronize: true,
      logging: false,
    }),
    AuthModule,
    AuditModule,
    HcmModule,
    BalancesModule,
    RequestsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
