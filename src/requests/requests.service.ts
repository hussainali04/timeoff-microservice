import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { TimeOffRequest, RequestStatus } from './request.entity';
import { randomUUID } from 'crypto';
import { CreateRequestDto } from './dto/create-request.dto';
import { BalancesService } from '../balances/balances.service';
import { LeaveType } from '../balances/balance.entity';
import { AuditService } from '../audit/audit.service';
import { HcmService, HcmUnreachableError } from '../hcm/hcm.service';

function minutesAgoDate(mins: number): Date {
  return new Date(Date.now() - mins * 60_000);
}

@Injectable()
export class RequestsService {
  private readonly logger = new Logger(RequestsService.name);

  constructor(
    @InjectRepository(TimeOffRequest) private readonly repo: Repository<TimeOffRequest>,
    private readonly balances: BalancesService,
    private readonly hcm: HcmService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateRequestDto): Promise<{ request: TimeOffRequest; httpStatus: number }> {
    const id = randomUUID();
    const leaveType = dto.leaveType as LeaveType;

    // Ensure balance exists and is reasonably fresh for availability check
    const { balance } = await this.balances.getOneWithStaleness(dto.employeeId, dto.locationId, leaveType);
    if (this.balances.availableDays(balance) < dto.daysRequested) {
      await this.audit.write({
        entityType: 'request',
        entityId: id,
        action: 'deducted',
        deltaDays: dto.daysRequested,
        source: 'employee_request',
        performedBy: dto.employeeId,
        metadata: { outcome: 'rejected_insufficient_balance' },
      });
      throw new HttpException('Insufficient balance', HttpStatus.CONFLICT);
    }

    // Reserve pending days with optimistic lock
    let reservedBalanceId: number | null = null;
    try {
      const reserved = await this.balances.reservePendingDaysOptimistic({
        employeeId: dto.employeeId,
        locationId: dto.locationId,
        leaveType,
        days: dto.daysRequested,
      });
      reservedBalanceId = reserved.id;
    } catch (e) {
      if (e instanceof HttpException) throw e;
      throw new HttpException('Balance conflict', HttpStatus.CONFLICT);
    }

    const request = this.repo.create({
      id,
      employee_id: dto.employeeId,
      location_id: dto.locationId,
      leave_type: leaveType,
      start_date: dto.startDate,
      end_date: dto.endDate,
      days_requested: dto.daysRequested,
      status: 'pending',
      manager_id: null,
      manager_note: null,
      hcm_reference_id: null,
    });

    // Call HCM to validate/deduct
    try {
      const res = await this.hcm.deductDays({
        employeeId: dto.employeeId,
        locationId: dto.locationId,
        leaveType,
        days: dto.daysRequested,
      });

      request.status = 'pending';
      request.hcm_reference_id = res.hcmReferenceId ?? null;
      const saved = await this.repo.save(request);

      await this.audit.write({
        entityType: 'request',
        entityId: saved.id,
        action: 'deducted',
        deltaDays: dto.daysRequested,
        source: 'employee_request',
        performedBy: dto.employeeId,
        metadata: { outcome: 'created_pending' },
      });

      return { request: saved, httpStatus: HttpStatus.CREATED };
    } catch (e: any) {
      if (e instanceof HcmUnreachableError) {
        request.status = 'pending_hcm_confirmation';
        const saved = await this.repo.save(request);
        await this.audit.write({
          entityType: 'request',
          entityId: saved.id,
          action: 'deducted',
          deltaDays: dto.daysRequested,
          source: 'employee_request',
          performedBy: dto.employeeId,
          metadata: { outcome: 'pending_hcm_confirmation' },
        });
        return { request: saved, httpStatus: HttpStatus.ACCEPTED };
      }

      // HCM returned error -> release reservation and 422
      if (reservedBalanceId) {
        try {
          await this.balances.releasePendingDaysOptimistic(reservedBalanceId, dto.daysRequested);
        } catch (releaseErr: any) {
          this.logger.error(`Failed to release reservation for request=${id}: ${releaseErr?.message ?? releaseErr}`);
        }
      }

      await this.audit.write({
        entityType: 'request',
        entityId: id,
        action: 'deducted',
        deltaDays: dto.daysRequested,
        source: 'employee_request',
        performedBy: dto.employeeId,
        metadata: { outcome: 'hcm_error', message: e?.message ?? 'HCM error' },
      });
      throw new HttpException(e?.message ?? 'HCM validation failed', HttpStatus.UNPROCESSABLE_ENTITY);
    }
  }

  async findOne(requestId: string): Promise<TimeOffRequest> {
    const r = await this.repo.findOne({ where: { id: requestId } });
    if (!r) throw new HttpException('Not found', HttpStatus.NOT_FOUND);
    return r;
  }

  async list(filter: { employeeId?: string; status?: RequestStatus }): Promise<TimeOffRequest[]> {
    const where: any = {};
    if (filter.employeeId) where.employee_id = filter.employeeId;
    if (filter.status) where.status = filter.status;
    return this.repo.find({ where, order: { created_at: 'DESC' } });
  }

  async approve(requestId: string, input: { managerId: string; managerNote?: string }) {
    const r = await this.findOne(requestId);
    if (r.status !== 'pending') throw new BadRequestException('Request is not pending');

    try {
      await this.hcm.deductDays({
        employeeId: r.employee_id,
        locationId: r.location_id,
        leaveType: r.leave_type,
        days: r.days_requested,
      });
    } catch (e: any) {
      if (e instanceof HcmUnreachableError) {
        throw new HttpException('HCM unreachable', HttpStatus.UNPROCESSABLE_ENTITY);
      }
      throw new HttpException(e?.message ?? 'HCM error', HttpStatus.UNPROCESSABLE_ENTITY);
    }

    const { balance } = await this.balances.getOneWithStaleness(r.employee_id, r.location_id, r.leave_type);
    const updatedBalance = await this.balances.movePendingToUsed(balance.id, r.days_requested);

    r.status = 'approved';
    r.manager_id = input.managerId;
    r.manager_note = input.managerNote ?? null;
    const saved = await this.repo.save(r);

    await this.audit.write({
      entityType: 'request',
      entityId: saved.id,
      action: 'approved',
      deltaDays: r.days_requested,
      source: 'manager_action',
      performedBy: input.managerId,
      metadata: { managerNote: input.managerNote ?? null },
    });

    // Post-write verification against HCM (expected total days)
    try {
      const hcmBal = await this.hcm.getBalance(r.employee_id, r.location_id, r.leave_type);
      const expected = updatedBalance.total_days; // cached total_days mirrors HCM total days
      // Because our local total_days is updated from HCM, verify HCM equals local total_days (after deduction)
      if (Number(hcmBal.totalDays) !== Number(expected)) {
        saved.status = 'needs_manual_review';
        await this.repo.save(saved);
        await this.audit.write({
          entityType: 'request',
          entityId: saved.id,
          action: 'approved',
          deltaDays: r.days_requested,
          source: 'system_reconciliation',
          performedBy: 'system',
          metadata: {
            alert: 'post_write_verification_mismatch',
            expected,
            actual: hcmBal.totalDays,
          },
        });
      }
    } catch (e) {
      // If unreachable during verification, flag manual review (spec wants mismatch check; unreachable is risky too)
      saved.status = 'needs_manual_review';
      await this.repo.save(saved);
      await this.audit.write({
        entityType: 'request',
        entityId: saved.id,
        action: 'approved',
        deltaDays: r.days_requested,
        source: 'system_reconciliation',
        performedBy: 'system',
        metadata: { alert: 'post_write_verification_unreachable' },
      });
    }

    return saved;
  }

  async reject(requestId: string, input: { managerId: string; managerNote?: string }) {
    const r = await this.findOne(requestId);
    if (r.status !== 'pending') throw new BadRequestException('Request is not pending');

    const { balance } = await this.balances.getOneWithStaleness(r.employee_id, r.location_id, r.leave_type);
    await this.balances.releasePendingDaysOptimistic(balance.id, r.days_requested);

    try {
      await this.hcm.restoreDays({
        employeeId: r.employee_id,
        locationId: r.location_id,
        leaveType: r.leave_type,
        days: r.days_requested,
      });
    } catch (e: any) {
      throw new HttpException(e?.message ?? 'HCM error', HttpStatus.UNPROCESSABLE_ENTITY);
    }

    r.status = 'rejected';
    r.manager_id = input.managerId;
    r.manager_note = input.managerNote ?? null;
    const saved = await this.repo.save(r);

    await this.audit.write({
      entityType: 'request',
      entityId: saved.id,
      action: 'rejected',
      deltaDays: r.days_requested,
      source: 'manager_action',
      performedBy: input.managerId,
      metadata: { managerNote: input.managerNote ?? null },
    });

    return saved;
  }

  async cancel(requestId: string, employeeId: string) {
    const r = await this.findOne(requestId);
    if (r.status !== 'pending') throw new BadRequestException('Only pending requests can be cancelled');
    if (r.employee_id !== employeeId) throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);

    const { balance } = await this.balances.getOneWithStaleness(r.employee_id, r.location_id, r.leave_type);
    await this.balances.releasePendingDaysOptimistic(balance.id, r.days_requested);

    try {
      await this.hcm.restoreDays({
        employeeId: r.employee_id,
        locationId: r.location_id,
        leaveType: r.leave_type,
        days: r.days_requested,
      });
    } catch (e: any) {
      throw new HttpException(e?.message ?? 'HCM error', HttpStatus.UNPROCESSABLE_ENTITY);
    }

    r.status = 'cancelled';
    const saved = await this.repo.save(r);

    await this.audit.write({
      entityType: 'request',
      entityId: saved.id,
      action: 'cancelled',
      deltaDays: r.days_requested,
      source: 'employee_request',
      performedBy: employeeId,
      metadata: null,
    });
    return saved;
  }

  async retryPendingHcmConfirmation(): Promise<number> {
    // Find all pending_hcm_confirmation older than 5 minutes
    const cutoff = minutesAgoDate(5);
    const candidates = await this.repo.find({
      where: {
        status: 'pending_hcm_confirmation',
        created_at: LessThan(cutoff),
      },
      order: { created_at: 'ASC' },
    });

    let processed = 0;
    for (const r of candidates) {
      processed += 1;
      const attempts =
        (r.manager_note && r.manager_note.startsWith('retry_attempts=')
          ? Number(r.manager_note.replace('retry_attempts=', ''))
          : 0) || 0;

      if (attempts >= 3) {
        r.status = 'needs_manual_review';
        await this.repo.save(r);
        await this.audit.write({
          entityType: 'request',
          entityId: r.id,
          action: 'approved',
          deltaDays: r.days_requested,
          source: 'system_reconciliation',
          performedBy: 'system',
          metadata: { alert: 'hcm_retry_exhausted' },
        });
        continue;
      }

      try {
        await this.hcm.deductDays({
          employeeId: r.employee_id,
          locationId: r.location_id,
          leaveType: r.leave_type,
          days: r.days_requested,
        });

        r.status = 'pending';
        r.manager_note = `retry_attempts=${attempts + 1}`;
        await this.repo.save(r);
        await this.audit.write({
          entityType: 'request',
          entityId: r.id,
          action: 'approved',
          deltaDays: r.days_requested,
          source: 'system_reconciliation',
          performedBy: 'system',
          metadata: { outcome: 'retry_success' },
        });
      } catch (e: any) {
        r.manager_note = `retry_attempts=${attempts + 1}`;
        await this.repo.save(r);
        this.logger.warn(`Retry failed request=${r.id} attempts=${attempts + 1}: ${e?.message ?? e}`);
      }
    }
    return processed;
  }
}

