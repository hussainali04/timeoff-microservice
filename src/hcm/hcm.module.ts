import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { HcmService } from './hcm.service';
import { HcmSyncController } from './hcm-sync.controller';
import { AuditModule } from '../audit/audit.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Balance } from '../balances/balance.entity';

@Module({
  imports: [
    HttpModule,
    AuditModule,
    TypeOrmModule.forFeature([Balance]),
  ],
  providers: [HcmService],
  exports: [HcmService],
  controllers: [HcmSyncController],
})
export class HcmModule {}

