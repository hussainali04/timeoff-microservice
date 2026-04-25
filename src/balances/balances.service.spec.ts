import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Balance } from './balance.entity';
import { BalancesService } from './balances.service';
import { HcmService, HcmUnreachableError } from '../hcm/hcm.service';
import { AuditService } from '../audit/audit.service';

describe('BalancesService', () => {
  let service: BalancesService;
  let repo: Repository<Balance>;
  let hcm: HcmService;

  beforeEach(async () => {
    process.env.BALANCE_TTL_MINUTES = '60';

    const moduleRef = await Test.createTestingModule({
      providers: [
        BalancesService,
        {
          provide: getRepositoryToken(Balance),
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
            findOneByOrFail: jest.fn(),
            findOneOrFail: jest.fn(),
            save: jest.fn(),
            update: jest.fn(),
            create: jest.fn((x) => x),
          },
        },
        {
          provide: HcmService,
          useValue: {
            getBalance: jest.fn(),
          },
        },
        {
          provide: AuditService,
          useValue: { write: jest.fn() },
        },
      ],
    }).compile();

    service = moduleRef.get(BalancesService);
    repo = moduleRef.get(getRepositoryToken(Balance));
    hcm = moduleRef.get(HcmService);
  });

  it('TTL uses minimum of 1 minute for non-positive values', async () => {
    process.env.BALANCE_TTL_MINUTES = '0';
    const fresh = {
      id: 1,
      employee_id: 'emp_123',
      location_id: 'loc_nyc',
      leave_type: 'annual',
      total_days: 20,
      used_days: 0,
      pending_days: 0,
      version: 1,
      last_synced_at: new Date(Date.now() - 30_000), // 30s ago (fresh under 1 minute)
    } as any;
    (repo.findOne as any).mockResolvedValue(fresh);
    const res = await service.getOneWithStaleness('emp_123', 'loc_nyc', 'annual');
    expect(res.stale).toBe(false);
  });

  it('getAllForEmployee returns repository results', async () => {
    (repo.find as any).mockResolvedValue([{ id: 1 }]);
    const out = await service.getAllForEmployee('emp_123');
    expect(out[0].id).toBe(1);
    expect((repo.find as any).mock.calls[0][0]).toEqual({ where: { employee_id: 'emp_123' } });
  });

  it('Returns cached balance when last_synced_at is within TTL', async () => {
    const fresh = {
      id: 1,
      employee_id: 'emp_123',
      location_id: 'loc_nyc',
      leave_type: 'annual',
      total_days: 20,
      used_days: 0,
      pending_days: 0,
      version: 1,
      last_synced_at: new Date(Date.now() - 5 * 60_000),
    } as any;
    (repo.findOne as any).mockResolvedValue(fresh);
    const res = await service.getOneWithStaleness('emp_123', 'loc_nyc', 'annual');
    expect(res.stale).toBe(false);
    expect(res.balance.id).toBe(1);
    expect((hcm.getBalance as any).mock.calls.length).toBe(0);
  });

  it('Fetches from HCM and updates cache when balance is stale', async () => {
    const stale = {
      id: 1,
      employee_id: 'emp_123',
      location_id: 'loc_nyc',
      leave_type: 'annual',
      total_days: 20,
      used_days: 0,
      pending_days: 0,
      version: 1,
      last_synced_at: new Date(Date.now() - 2 * 60 * 60_000),
    } as any;
    (repo.findOne as any).mockResolvedValue(stale);
    (hcm.getBalance as any).mockResolvedValue({ totalDays: 18 });
    (repo.save as any).mockImplementation(async (x) => x);
    const res = await service.getOneWithStaleness('emp_123', 'loc_nyc', 'annual');
    expect(res.stale).toBe(false);
    expect(res.balance.total_days).toBe(18);
  });

  it('Stale refresh rethrows non-HCM errors', async () => {
    const stale = {
      id: 1,
      employee_id: 'emp_123',
      location_id: 'loc_nyc',
      leave_type: 'annual',
      total_days: 20,
      used_days: 0,
      pending_days: 0,
      version: 1,
      last_synced_at: new Date(Date.now() - 2 * 60 * 60_000),
    } as any;
    (repo.findOne as any).mockResolvedValue(stale);
    (hcm.getBalance as any).mockRejectedValue(new Error('boom'));
    await expect(service.getOneWithStaleness('emp_123', 'loc_nyc', 'annual')).rejects.toThrow('boom');
  });

  it('Returns stale cache with stale: true when HCM is unreachable', async () => {
    const stale = {
      id: 1,
      employee_id: 'emp_123',
      location_id: 'loc_nyc',
      leave_type: 'annual',
      total_days: 20,
      used_days: 0,
      pending_days: 0,
      version: 1,
      last_synced_at: new Date(Date.now() - 2 * 60 * 60_000),
    } as any;
    (repo.findOne as any).mockResolvedValue(stale);
    (hcm.getBalance as any).mockRejectedValue(new HcmUnreachableError());
    const res = await service.getOneWithStaleness('emp_123', 'loc_nyc', 'annual');
    expect(res.stale).toBe(true);
    expect(res.balance.total_days).toBe(20);
  });

  it('Correctly uses composite key (employeeId + locationId + leaveType)', async () => {
    (repo.findOne as any).mockResolvedValue(null);
    (hcm.getBalance as any).mockResolvedValue({ totalDays: 22 });
    (repo.save as any).mockImplementation(async (x) => ({ ...x, id: 9 }));
    const res = await service.getOneWithStaleness('emp_123', 'loc_nyc', 'annual');
    expect((repo.findOne as any).mock.calls[0][0].where).toEqual({
      employee_id: 'emp_123',
      location_id: 'loc_nyc',
      leave_type: 'annual',
    });
    expect(res.balance.id).toBe(9);
  });

  it('Cache miss returns 404 when HCM is unreachable', async () => {
    (repo.findOne as any).mockResolvedValue(null);
    (hcm.getBalance as any).mockRejectedValue(new HcmUnreachableError());
    await expect(service.getOneWithStaleness('emp_123', 'loc_nyc', 'annual')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('Cache miss rethrows non-HCM errors', async () => {
    (repo.findOne as any).mockResolvedValue(null);
    (hcm.getBalance as any).mockRejectedValue(new Error('boom'));
    await expect(service.getOneWithStaleness('emp_123', 'loc_nyc', 'annual')).rejects.toThrow('boom');
  });

  it('Reserves pending_days using optimistic locking and increments version', async () => {
    const b = {
      id: 10,
      employee_id: 'emp_123',
      location_id: 'loc_nyc',
      leave_type: 'annual',
      total_days: 20,
      used_days: 0,
      pending_days: 0,
      version: 7,
    } as any;
    (repo.findOneOrFail as any).mockResolvedValue(b);
    (repo.update as any).mockResolvedValue({ affected: 1 });
    (repo.findOneByOrFail as any).mockResolvedValue({ ...b, pending_days: 2, version: 8 });
    const updated = await service.reservePendingDaysOptimistic({
      employeeId: 'emp_123',
      locationId: 'loc_nyc',
      leaveType: 'annual',
      days: 2,
    });
    expect((repo.update as any).mock.calls[0][0]).toEqual({ id: 10, version: 7 });
    expect(updated.pending_days).toBe(2);
    expect(updated.version).toBe(8);
  });

  it('reservePendingDaysOptimistic returns 409 when insufficient available days', async () => {
    const b = {
      id: 10,
      employee_id: 'emp_123',
      location_id: 'loc_nyc',
      leave_type: 'annual',
      total_days: 1,
      used_days: 0,
      pending_days: 0,
      version: 1,
    } as any;
    (repo.findOneOrFail as any).mockResolvedValue(b);
    await expect(
      service.reservePendingDaysOptimistic({
        employeeId: 'emp_123',
        locationId: 'loc_nyc',
        leaveType: 'annual',
        days: 2,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('releasePendingDaysOptimistic decrements pending_days and increments version', async () => {
    const b = { id: 5, pending_days: 3, version: 2 } as any;
    (repo.findOneByOrFail as any).mockResolvedValueOnce(b);
    (repo.update as any).mockResolvedValue({ affected: 1 });
    (repo.findOneByOrFail as any).mockResolvedValueOnce({ ...b, pending_days: 1, version: 3 });
    const out = await service.releasePendingDaysOptimistic(5, 2);
    expect(out.pending_days).toBe(1);
    expect(out.version).toBe(3);
  });

  it('movePendingToUsed moves pending to used and increments version', async () => {
    const b = { id: 5, pending_days: 3, used_days: 4, version: 2 } as any;
    (repo.findOneByOrFail as any).mockResolvedValueOnce(b);
    (repo.update as any).mockResolvedValue({ affected: 1 });
    (repo.findOneByOrFail as any).mockResolvedValueOnce({
      ...b,
      pending_days: 1,
      used_days: 6,
      version: 3,
    });
    const out = await service.movePendingToUsed(5, 2);
    expect(out.pending_days).toBe(1);
    expect(out.used_days).toBe(6);
    expect(out.version).toBe(3);
  });

  it('reservePendingDaysOptimistic returns 409 when optimistic update affects 0 rows', async () => {
    const b = {
      id: 10,
      employee_id: 'emp_123',
      location_id: 'loc_nyc',
      leave_type: 'annual',
      total_days: 10,
      used_days: 0,
      pending_days: 0,
      version: 1,
    } as any;
    (repo.findOneOrFail as any).mockResolvedValue(b);
    (repo.update as any).mockResolvedValue({ affected: 0 });
    await expect(
      service.reservePendingDaysOptimistic({
        employeeId: 'emp_123',
        locationId: 'loc_nyc',
        leaveType: 'annual',
        days: 2,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('releasePendingDaysOptimistic returns 409 when optimistic update affects 0 rows', async () => {
    const b = { id: 5, pending_days: 3, version: 2 } as any;
    (repo.findOneByOrFail as any).mockResolvedValueOnce(b);
    (repo.update as any).mockResolvedValue({ affected: 0 });
    await expect(service.releasePendingDaysOptimistic(5, 1)).rejects.toMatchObject({ status: 409 });
  });

  it('movePendingToUsed returns 409 when optimistic update affects 0 rows', async () => {
    const b = { id: 5, pending_days: 3, used_days: 4, version: 2 } as any;
    (repo.findOneByOrFail as any).mockResolvedValueOnce(b);
    (repo.update as any).mockResolvedValue({ affected: 0 });
    await expect(service.movePendingToUsed(5, 1)).rejects.toMatchObject({ status: 409 });
  });
});

