import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TimeOffRequest } from './request.entity';
import { RequestsService } from './requests.service';
import { RequestsController } from './requests.controller';
import { BalancesModule } from '../balances/balances.module';
import { AuditModule } from '../audit/audit.module';
import { HcmModule } from '../hcm/hcm.module';
import { RequestsRetryJob } from './requests.retry.job';

@Module({
  imports: [
    TypeOrmModule.forFeature([TimeOffRequest]),
    BalancesModule,
    AuditModule,
    HcmModule,
  ],
  providers: [RequestsService, RequestsRetryJob],
  controllers: [RequestsController],
})
export class RequestsModule {}

