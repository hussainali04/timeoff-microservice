import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RequestsService } from './requests.service';
import { TimeOffRequest } from './request.entity';
import { BalancesService } from '../balances/balances.service';
import { AuditService } from '../audit/audit.service';
import { HcmService, HcmUnreachableError } from '../hcm/hcm.service';
import { HttpException } from '@nestjs/common';

describe('RequestsService', () => {
  let service: RequestsService;
  let repo: Repository<TimeOffRequest>;
  let balances: BalancesService;
  let hcm: HcmService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        RequestsService,
        {
          provide: getRepositoryToken(TimeOffRequest),
          useValue: {
            create: jest.fn((x) => x),
            save: jest.fn(async (x) => x),
            findOne: jest.fn(),
            find: jest.fn(),
          },
        },
        {
          provide: BalancesService,
          useValue: {
            getOneWithStaleness: jest.fn(),
            availableDays: jest.fn(),
            reservePendingDaysOptimistic: jest.fn(),
            releasePendingDaysOptimistic: jest.fn(),
            movePendingToUsed: jest.fn(),
          },
        },
        {
          provide: HcmService,
          useValue: {
            deductDays: jest.fn(),
            restoreDays: jest.fn(),
            getBalance: jest.fn(),
          },
        },
        {
          provide: AuditService,
          useValue: { write: jest.fn() },
        },
      ],
    }).compile();

    service = moduleRef.get(RequestsService);
    repo = moduleRef.get(getRepositoryToken(TimeOffRequest));
    balances = moduleRef.get(BalancesService);
    hcm = moduleRef.get(HcmService);
  });

  it('Rejects with 409 when available balance is insufficient', async () => {
    (balances.getOneWithStaleness as any).mockResolvedValue({ balance: { id: 1 }, stale: false });
    (balances.availableDays as any).mockReturnValue(0);
    await expect(
      service.create({
        employeeId: 'emp_123',
        locationId: 'loc_nyc',
        leaveType: 'annual',
        startDate: '2026-01-01',
        endDate: '2026-01-02',
        daysRequested: 2,
      } as any),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('Reserves pending_days before calling HCM', async () => {
    (balances.getOneWithStaleness as any).mockResolvedValue({ balance: { id: 1 }, stale: false });
    (balances.availableDays as any).mockReturnValue(10);
    (balances.reservePendingDaysOptimistic as any).mockResolvedValue({ id: 1 });
    (hcm.deductDays as any).mockResolvedValue({ referenceId: 'x' });

    await service.create({
      employeeId: 'emp_123',
      locationId: 'loc_nyc',
      leaveType: 'annual',
      startDate: '2026-01-01',
      endDate: '2026-01-02',
      daysRequested: 2,
    } as any);

    expect((balances.reservePendingDaysOptimistic as any).mock.calls.length).toBe(1);
    expect((hcm.deductDays as any).mock.calls.length).toBe(1);
  });

  it('Releases reservation if HCM returns error', async () => {
    (balances.getOneWithStaleness as any).mockResolvedValue({ balance: { id: 1 }, stale: false });
    (balances.availableDays as any).mockReturnValue(10);
    (balances.reservePendingDaysOptimistic as any).mockResolvedValue({ id: 7 });
    (hcm.deductDays as any).mockRejectedValue(new Error('HCM says no'));

    await expect(
      service.create({
        employeeId: 'emp_123',
        locationId: 'loc_nyc',
        leaveType: 'annual',
        startDate: '2026-01-01',
        endDate: '2026-01-02',
        daysRequested: 2,
      } as any),
    ).rejects.toMatchObject({ status: 422 });

    expect((balances.releasePendingDaysOptimistic as any).mock.calls[0][0]).toBe(7);
  });

  it('Create logs and continues when reservation release fails after HCM error', async () => {
    (balances.getOneWithStaleness as any).mockResolvedValue({ balance: { id: 1 }, stale: false });
    (balances.availableDays as any).mockReturnValue(10);
    (balances.reservePendingDaysOptimistic as any).mockResolvedValue({ id: 7 });
    (hcm.deductDays as any).mockRejectedValue(new Error('HCM says no'));
    (balances.releasePendingDaysOptimistic as any).mockRejectedValue(new Error('release failed'));
    await expect(
      service.create({
        employeeId: 'emp_123',
        locationId: 'loc_nyc',
        leaveType: 'annual',
        startDate: '2026-01-01',
        endDate: '2026-01-02',
        daysRequested: 2,
      } as any),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('Create returns 201 and status pending on HCM success', async () => {
    (balances.getOneWithStaleness as any).mockResolvedValue({ balance: { id: 1 }, stale: false });
    (balances.availableDays as any).mockReturnValue(10);
    (balances.reservePendingDaysOptimistic as any).mockResolvedValue({ id: 1 });
    (hcm.deductDays as any).mockResolvedValue({ hcmReferenceId: 'hcm_ref_1' });
    (repo.save as any).mockImplementation(async (x) => x);
    const res = await service.create({
      employeeId: 'emp_123',
      locationId: 'loc_nyc',
      leaveType: 'annual',
      startDate: '2026-01-01',
      endDate: '2026-01-02',
      daysRequested: 2,
    } as any);
    expect(res.httpStatus).toBe(201);
    expect(res.request.status).toBe('pending');
  });

  it('Sets status to pending_hcm_confirmation when HCM is unreachable', async () => {
    (balances.getOneWithStaleness as any).mockResolvedValue({ balance: { id: 1 }, stale: false });
    (balances.availableDays as any).mockReturnValue(10);
    (balances.reservePendingDaysOptimistic as any).mockResolvedValue({ id: 1 });
    (hcm.deductDays as any).mockRejectedValue(new HcmUnreachableError());
    const res = await service.create({
      employeeId: 'emp_123',
      locationId: 'loc_nyc',
      leaveType: 'annual',
      startDate: '2026-01-01',
      endDate: '2026-01-02',
      daysRequested: 2,
    } as any);
    expect(res.httpStatus).toBe(202);
    expect(res.request.status).toBe('pending_hcm_confirmation');
  });

  it('Approve moves pending to used on HCM success', async () => {
    (repo.findOne as any).mockResolvedValue({
      id: 'req_1',
      employee_id: 'emp_123',
      location_id: 'loc_nyc',
      leave_type: 'annual',
      days_requested: 2,
      status: 'pending',
      manager_id: null,
      manager_note: null,
    });
    (hcm.deductDays as any).mockResolvedValue({ ok: true });
    (balances.getOneWithStaleness as any).mockResolvedValue({ balance: { id: 99 }, stale: false });
    (balances.movePendingToUsed as any).mockResolvedValue({ id: 99, total_days: 20 });
    (hcm.getBalance as any).mockResolvedValue({ totalDays: 20 });
    (repo.save as any).mockImplementation(async (x) => x);

    const out = await service.approve('req_1', { managerId: 'mgr_1', managerNote: 'ok' });
    expect(out.status === 'approved' || out.status === 'needs_manual_review').toBe(true);
    expect((balances.movePendingToUsed as any).mock.calls.length).toBe(1);
  });

  it('Approve returns 422 when HCM returns error', async () => {
    (repo.findOne as any).mockResolvedValue({
      id: 'req_err',
      employee_id: 'emp_123',
      location_id: 'loc_nyc',
      leave_type: 'annual',
      days_requested: 2,
      status: 'pending',
    });
    (hcm.deductDays as any).mockRejectedValue(new Error('HCM error'));
    await expect(service.approve('req_err', { managerId: 'mgr_1' })).rejects.toMatchObject({
      status: 422,
    });
  });

  it('Approve returns 422 when HCM is unreachable', async () => {
    (repo.findOne as any).mockResolvedValue({
      id: 'req_u',
      employee_id: 'emp_123',
      location_id: 'loc_nyc',
      leave_type: 'annual',
      days_requested: 2,
      status: 'pending',
    });
    (hcm.deductDays as any).mockRejectedValue(new HcmUnreachableError());
    await expect(service.approve('req_u', { managerId: 'mgr_1' })).rejects.toMatchObject({
      status: 422,
    });
  });

  it('Approve flags needs_manual_review when post-write verification is unreachable', async () => {
    (repo.findOne as any).mockResolvedValue({
      id: 'req_vu',
      employee_id: 'emp_123',
      location_id: 'loc_nyc',
      leave_type: 'annual',
      days_requested: 2,
      status: 'pending',
      manager_id: null,
      manager_note: null,
    });
    (hcm.deductDays as any).mockResolvedValue({ ok: true });
    (balances.getOneWithStaleness as any).mockResolvedValue({ balance: { id: 99 }, stale: false });
    (balances.movePendingToUsed as any).mockResolvedValue({ id: 99, total_days: 20 });
    (hcm.getBalance as any).mockRejectedValue(new HcmUnreachableError());
    (repo.save as any).mockImplementation(async (x) => x);
    const out = await service.approve('req_vu', { managerId: 'mgr_1' });
    expect(out.status).toBe('needs_manual_review');
  });

  it('Approve flags needs_manual_review when post-write verification mismatches', async () => {
    (repo.findOne as any).mockResolvedValue({
      id: 'req_mm',
      employee_id: 'emp_123',
      location_id: 'loc_nyc',
      leave_type: 'annual',
      days_requested: 2,
      status: 'pending',
      manager_id: null,
      manager_note: null,
    });
    (hcm.deductDays as any).mockResolvedValue({ ok: true });
    (balances.getOneWithStaleness as any).mockResolvedValue({ balance: { id: 99 }, stale: false });
    (balances.movePendingToUsed as any).mockResolvedValue({ id: 99, total_days: 20 });
    (hcm.getBalance as any).mockResolvedValue({ totalDays: 19 }); // mismatch
    (repo.save as any).mockImplementation(async (x) => x);
    const out = await service.approve('req_mm', { managerId: 'mgr_1' });
    expect(out.status).toBe('needs_manual_review');
  });

  it('Reject restores pending days and sets status rejected', async () => {
    (repo.findOne as any).mockResolvedValue({
      id: 'req_2',
      employee_id: 'emp_123',
      location_id: 'loc_nyc',
      leave_type: 'annual',
      days_requested: 1,
      status: 'pending',
    });
    (balances.getOneWithStaleness as any).mockResolvedValue({ balance: { id: 9 }, stale: false });
    (balances.releasePendingDaysOptimistic as any).mockResolvedValue({ id: 9 });
    (hcm.restoreDays as any).mockResolvedValue(undefined);
    (repo.save as any).mockImplementation(async (x) => x);
    const out = await service.reject('req_2', { managerId: 'mgr_1', managerNote: 'no' });
    expect(out.status).toBe('rejected');
    expect((hcm.restoreDays as any).mock.calls.length).toBe(1);
  });

  it('Reject rejects when request not pending', async () => {
    (repo.findOne as any).mockResolvedValue({ id: 'req_np', status: 'approved' });
    await expect(service.reject('req_np', { managerId: 'mgr_1' } as any)).rejects.toMatchObject({
      status: 400,
    });
  });

  it('Reject returns 422 when HCM restore fails', async () => {
    (repo.findOne as any).mockResolvedValue({
      id: 'req_r_err',
      employee_id: 'emp_123',
      location_id: 'loc_nyc',
      leave_type: 'annual',
      days_requested: 1,
      status: 'pending',
    });
    (balances.getOneWithStaleness as any).mockResolvedValue({ balance: { id: 9 }, stale: false });
    (balances.releasePendingDaysOptimistic as any).mockResolvedValue({ id: 9 });
    (hcm.restoreDays as any).mockRejectedValue(new Error('restore failed'));
    await expect(service.reject('req_r_err', { managerId: 'mgr_1' })).rejects.toMatchObject({
      status: 422,
    });
  });

  it('Cancel restores pending days and sets status cancelled', async () => {
    (repo.findOne as any).mockResolvedValue({
      id: 'req_3',
      employee_id: 'emp_123',
      location_id: 'loc_nyc',
      leave_type: 'annual',
      days_requested: 1,
      status: 'pending',
    });
    (balances.getOneWithStaleness as any).mockResolvedValue({ balance: { id: 9 }, stale: false });
    (balances.releasePendingDaysOptimistic as any).mockResolvedValue({ id: 9 });
    (hcm.restoreDays as any).mockResolvedValue(undefined);
    (repo.save as any).mockImplementation(async (x) => x);
    const out = await service.cancel('req_3', 'emp_123');
    expect(out.status).toBe('cancelled');
  });

  it('Cancel rejects when employeeId does not match request', async () => {
    (repo.findOne as any).mockResolvedValue({
      id: 'req_forbid',
      employee_id: 'emp_999',
      location_id: 'loc_nyc',
      leave_type: 'annual',
      days_requested: 1,
      status: 'pending',
    });
    await expect(service.cancel('req_forbid', 'emp_123')).rejects.toMatchObject({ status: 403 });
  });

  it('Cancel returns 422 when HCM restore fails', async () => {
    (repo.findOne as any).mockResolvedValue({
      id: 'req_c_err',
      employee_id: 'emp_123',
      location_id: 'loc_nyc',
      leave_type: 'annual',
      days_requested: 1,
      status: 'pending',
    });
    (balances.getOneWithStaleness as any).mockResolvedValue({ balance: { id: 9 }, stale: false });
    (balances.releasePendingDaysOptimistic as any).mockResolvedValue({ id: 9 });
    (hcm.restoreDays as any).mockRejectedValue(new Error('restore failed'));
    await expect(service.cancel('req_c_err', 'emp_123')).rejects.toMatchObject({ status: 422 });
  });

  it('Cancel rejects when request is not pending', async () => {
    (repo.findOne as any).mockResolvedValue({
      id: 'req_4',
      employee_id: 'emp_123',
      location_id: 'loc_nyc',
      leave_type: 'annual',
      days_requested: 1,
      status: 'approved',
    });
    await expect(service.cancel('req_4', 'emp_123')).rejects.toMatchObject({ status: 400 });
  });

  it('retryPendingHcmConfirmation marks needs_manual_review after 3 attempts', async () => {
    (repo.find as any).mockResolvedValue([
      {
        id: 'req_5',
        employee_id: 'emp_123',
        location_id: 'loc_nyc',
        leave_type: 'annual',
        days_requested: 1,
        status: 'pending_hcm_confirmation',
        created_at: new Date(Date.now() - 10 * 60_000),
        manager_note: 'retry_attempts=3',
      },
    ]);
    (repo.save as any).mockImplementation(async (x) => x);
    const processed = await service.retryPendingHcmConfirmation();
    expect(processed).toBe(1);
    expect((repo.save as any).mock.calls[0][0].status).toBe('needs_manual_review');
  });

  it('retryPendingHcmConfirmation retries and sets status pending on success', async () => {
    (repo.find as any).mockResolvedValue([
      {
        id: 'req_6',
        employee_id: 'emp_123',
        location_id: 'loc_nyc',
        leave_type: 'annual',
        days_requested: 1,
        status: 'pending_hcm_confirmation',
        created_at: new Date(Date.now() - 10 * 60_000),
        manager_note: 'retry_attempts=0',
      },
    ]);
    (hcm.deductDays as any).mockResolvedValue({ ok: true });
    (repo.save as any).mockImplementation(async (x) => x);
    const processed = await service.retryPendingHcmConfirmation();
    expect(processed).toBe(1);
    const lastSave = (repo.save as any).mock.calls[(repo.save as any).mock.calls.length - 1][0];
    expect(lastSave.status).toBe('pending');
  });

  it('retryPendingHcmConfirmation records retry attempt on failure', async () => {
    (repo.find as any).mockResolvedValue([
      {
        id: 'req_7',
        employee_id: 'emp_123',
        location_id: 'loc_nyc',
        leave_type: 'annual',
        days_requested: 1,
        status: 'pending_hcm_confirmation',
        created_at: new Date(Date.now() - 10 * 60_000),
        manager_note: null,
      },
    ]);
    (hcm.deductDays as any).mockRejectedValue(new HcmUnreachableError());
    (repo.save as any).mockImplementation(async (x) => x);
    const processed = await service.retryPendingHcmConfirmation();
    expect(processed).toBe(1);
    const saved = (repo.save as any).mock.calls[0][0];
    expect(saved.manager_note).toBe('retry_attempts=1');
  });

  it('retryPendingHcmConfirmation parses existing retry_attempts and increments', async () => {
    (repo.find as any).mockResolvedValue([
      {
        id: 'req_8',
        employee_id: 'emp_123',
        location_id: 'loc_nyc',
        leave_type: 'annual',
        days_requested: 1,
        status: 'pending_hcm_confirmation',
        created_at: new Date(Date.now() - 10 * 60_000),
        manager_note: 'retry_attempts=2',
      },
    ]);
    (hcm.deductDays as any).mockRejectedValue(new HcmUnreachableError());
    (repo.save as any).mockImplementation(async (x) => x);
    await service.retryPendingHcmConfirmation();
    const saved = (repo.save as any).mock.calls[0][0];
    expect(saved.manager_note).toBe('retry_attempts=3');
  });

  it('Aborts with conflict error when optimistic lock version mismatches', async () => {
    (balances.getOneWithStaleness as any).mockResolvedValue({ balance: { id: 1 }, stale: false });
    (balances.availableDays as any).mockReturnValue(10);
    (balances.reservePendingDaysOptimistic as any).mockRejectedValue(new HttpException('Balance conflict', 409));
    await expect(
      service.create({
        employeeId: 'emp_123',
        locationId: 'loc_nyc',
        leaveType: 'annual',
        startDate: '2026-01-01',
        endDate: '2026-01-02',
        daysRequested: 2,
      } as any),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('Create returns 409 when reservePending throws non-HttpException', async () => {
    (balances.getOneWithStaleness as any).mockResolvedValue({ balance: { id: 1 }, stale: false });
    (balances.availableDays as any).mockReturnValue(10);
    (balances.reservePendingDaysOptimistic as any).mockRejectedValue(new Error('race'));
    await expect(
      service.create({
        employeeId: 'emp_123',
        locationId: 'loc_nyc',
        leaveType: 'annual',
        startDate: '2026-01-01',
        endDate: '2026-01-02',
        daysRequested: 2,
      } as any),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('list supports no filters and filtered queries', async () => {
    (repo.find as any).mockResolvedValueOnce([{ id: 'a' }]).mockResolvedValueOnce([{ id: 'b' }]);
    const all = await service.list({});
    expect(all[0].id).toBe('a');
    const filtered = await service.list({ employeeId: 'emp_123', status: 'pending' as any });
    expect(filtered[0].id).toBe('b');
    expect((repo.find as any).mock.calls[1][0].where).toEqual({
      employee_id: 'emp_123',
      status: 'pending',
    });
  });
});

