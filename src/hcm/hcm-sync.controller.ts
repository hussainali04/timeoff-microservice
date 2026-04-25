import {
  Body,
  Controller,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Balance, LeaveType } from '../balances/balance.entity';
import { AuditService } from '../audit/audit.service';
import { randomUUID } from 'crypto';
import { Public } from '../auth/public.decorator';
import { SyncBalancesDto } from '../balances/dto/sync-balances.dto';

@Controller('hcm')
export class HcmSyncController {
  constructor(
    @InjectRepository(Balance) private readonly balances: Repository<Balance>,
    private readonly audit: AuditService,
  ) {}

  @Public()
  @Post('batch-sync')
  async batchSync(
    @Headers('x-hcm-api-key') apiKey: string | undefined,
    @Body() dto: SyncBalancesDto,
  ) {
    const expected = process.env.HCM_SYNC_API_KEY ?? '';
    if (!apiKey || apiKey !== expected) {
      throw new UnauthorizedException('Invalid HCM API key');
    }

    const syncId = `sync_${randomUUID()}`;
    let synced = 0;

    for (const record of dto.records) {
      const leaveType = record.leaveType as LeaveType;
      const existing = await this.balances.findOne({
        where: {
          employee_id: record.employeeId,
          location_id: record.locationId,
          leave_type: leaveType,
        },
      });

      const entity = this.balances.create({
        ...(existing ?? {}),
        employee_id: record.employeeId,
        location_id: record.locationId,
        leave_type: leaveType,
        total_days: record.totalDays,
        last_synced_at: new Date(),
        version: 1,
      });

      await this.balances.save(entity);
      synced += 1;

      await this.audit.write({
        entityType: 'balance',
        entityId: String(entity.id),
        action: 'batch_synced',
        deltaDays: null,
        source: 'hcm_batch',
        performedBy: 'hcm',
        metadata: { syncId },
      });
    }

    return { synced, errors: 0, syncId };
  }
}

