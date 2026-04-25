import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Balance, LeaveType } from './balance.entity';
import { HcmService, HcmUnreachableError } from '../hcm/hcm.service';
import { AuditService } from '../audit/audit.service';

function ttlMs(): number {
  const mins = Number(process.env.BALANCE_TTL_MINUTES ?? 60);
  return Math.max(1, mins) * 60_000;
}

@Injectable()
export class BalancesService {
  private readonly logger = new Logger(BalancesService.name);

  constructor(
    @InjectRepository(Balance) private readonly repo: Repository<Balance>,
    private readonly hcm: HcmService,
    private readonly audit: AuditService,
  ) {}

  async getAllForEmployee(employeeId: string): Promise<Balance[]> {
    return this.repo.find({ where: { employee_id: employeeId } });
  }

  async getOneWithStaleness(
    employeeId: string,
    locationId: string,
    leaveType: LeaveType,
  ): Promise<{ balance: Balance; stale: boolean }> {
    const existing = await this.repo.findOne({
      where: { employee_id: employeeId, location_id: locationId, leave_type: leaveType },
    });

    if (!existing) {
      // If no cache, attempt HCM fetch; if unreachable, 404
      try {
        const hcmBal = await this.hcm.getBalance(employeeId, locationId, leaveType);
        const created = await this.repo.save(
          this.repo.create({
            employee_id: employeeId,
            location_id: locationId,
            leave_type: leaveType,
            total_days: hcmBal.totalDays,
            used_days: 0,
            pending_days: 0,
            version: 1,
            last_synced_at: new Date(),
          }),
        );
        await this.audit.write({
          entityType: 'balance',
          entityId: String(created.id),
          action: 'batch_synced',
          deltaDays: null,
          source: 'hcm_realtime',
          performedBy: 'system',
          metadata: { reason: 'cache_miss' },
        });
        return { balance: created, stale: false };
      } catch (e) {
        if (e instanceof HcmUnreachableError) {
          throw new HttpException('Balance not available', HttpStatus.NOT_FOUND);
        }
        throw e;
      }
    }

    const last = existing.last_synced_at?.getTime() ?? 0;
    const isStale = Date.now() - last > ttlMs();
    if (!isStale) return { balance: existing, stale: false };

    try {
      const hcmBal = await this.hcm.getBalance(employeeId, locationId, leaveType);
      existing.total_days = hcmBal.totalDays;
      existing.last_synced_at = new Date();
      const saved = await this.repo.save(existing);
      await this.audit.write({
        entityType: 'balance',
        entityId: String(saved.id),
        action: 'batch_synced',
        deltaDays: null,
        source: 'hcm_realtime',
        performedBy: 'system',
        metadata: { reason: 'ttl_refresh' },
      });
      return { balance: saved, stale: false };
    } catch (e) {
      if (e instanceof HcmUnreachableError) {
        this.logger.warn(
          `Returning stale cache employee=${employeeId} location=${locationId} leaveType=${leaveType}`,
        );
        return { balance: existing, stale: true };
      }
      throw e;
    }
  }

  availableDays(b: Balance): number {
    return b.total_days - b.used_days - b.pending_days;
  }

  async reservePendingDaysOptimistic(input: {
    employeeId: string;
    locationId: string;
    leaveType: LeaveType;
    days: number;
  }): Promise<Balance> {
    const b = await this.repo.findOneOrFail({
      where: {
        employee_id: input.employeeId,
        location_id: input.locationId,
        leave_type: input.leaveType,
      },
    });
    if (this.availableDays(b) < input.days) {
      throw new HttpException('Insufficient balance', HttpStatus.CONFLICT);
    }
    const currentVersion = b.version;
    const result = await this.repo.update(
      { id: b.id, version: currentVersion },
      {
        pending_days: b.pending_days + input.days,
        version: currentVersion + 1,
      },
    );
    if ((result.affected ?? 0) === 0) {
      throw new HttpException('Balance conflict', HttpStatus.CONFLICT);
    }
    const updated = await this.repo.findOneByOrFail({ id: b.id });
    await this.audit.write({
      entityType: 'balance',
      entityId: String(updated.id),
      action: 'deducted',
      deltaDays: input.days,
      source: 'employee_request',
      performedBy: input.employeeId,
      metadata: { kind: 'reserve_pending' },
    });
    return updated;
  }

  async releasePendingDaysOptimistic(balanceId: number, days: number): Promise<Balance> {
    const b = await this.repo.findOneByOrFail({ id: balanceId });
    const currentVersion = b.version;
    const nextPending = Math.max(0, b.pending_days - days);
    const result = await this.repo.update(
      { id: b.id, version: currentVersion },
      {
        pending_days: nextPending,
        version: currentVersion + 1,
      },
    );
    if ((result.affected ?? 0) === 0) {
      throw new HttpException('Balance conflict', HttpStatus.CONFLICT);
    }
    return this.repo.findOneByOrFail({ id: b.id });
  }

  async movePendingToUsed(balanceId: number, days: number): Promise<Balance> {
    const b = await this.repo.findOneByOrFail({ id: balanceId });
    const currentVersion = b.version;
    const nextPending = Math.max(0, b.pending_days - days);
    const result = await this.repo.update(
      { id: b.id, version: currentVersion },
      {
        pending_days: nextPending,
        used_days: b.used_days + days,
        version: currentVersion + 1,
      },
    );
    if ((result.affected ?? 0) === 0) {
      throw new HttpException('Balance conflict', HttpStatus.CONFLICT);
    }
    return this.repo.findOneByOrFail({ id: b.id });
  }
}

