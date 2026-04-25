import { Test } from '@nestjs/testing';
import { HcmService, HcmUnreachableError } from './hcm.service';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';

describe('HcmSyncService (batch upsert + audit)', () => {
  it('getBalance returns totalDays from HCM payload', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        HcmService,
        { provide: HttpService, useValue: { get: jest.fn(), post: jest.fn() } },
      ],
    }).compile();

    const svc = moduleRef.get(HcmService);
    const http = moduleRef.get(HttpService) as any;
    http.get.mockReturnValue(of({ data: { balance: 12 } }));
    const res = await svc.getBalance('emp_123', 'loc_nyc', 'annual');
    expect(res.totalDays).toBe(12);
  });

  it('getBalance defaults to 0 when payload missing balance', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        HcmService,
        { provide: HttpService, useValue: { get: jest.fn(), post: jest.fn() } },
      ],
    }).compile();
    const svc = moduleRef.get(HcmService);
    const http = moduleRef.get(HttpService) as any;
    http.get.mockReturnValue(of({ data: {} }));
    const res = await svc.getBalance('emp_123', 'loc_nyc', 'annual');
    expect(res.totalDays).toBe(0);
  });

  it('deductDays throws on HCM validation error (422)', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        HcmService,
        { provide: HttpService, useValue: { get: jest.fn(), post: jest.fn() } },
      ],
    }).compile();
    const svc = moduleRef.get(HcmService);
    const http = moduleRef.get(HttpService) as any;
    http.post.mockReturnValue(
      throwError(() => ({ response: { status: 422, data: { message: 'Insufficient balance' } } })),
    );
    await expect(
      svc.deductDays({ employeeId: 'emp_123', locationId: 'loc_nyc', leaveType: 'annual', days: 5 }),
    ).rejects.toThrow('Insufficient balance');
  });

  it('deductDays uses default message when HCM response has no message', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        HcmService,
        { provide: HttpService, useValue: { get: jest.fn(), post: jest.fn() } },
      ],
    }).compile();
    const svc = moduleRef.get(HcmService);
    const http = moduleRef.get(HttpService) as any;
    http.post.mockReturnValue(throwError(() => ({ response: { status: 422, data: {} } })));
    await expect(
      svc.deductDays({ employeeId: 'emp_123', locationId: 'loc_nyc', leaveType: 'annual', days: 5 }),
    ).rejects.toThrow('HCM validation failed');
  });

  it('deductDays returns referenceId on success', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        HcmService,
        { provide: HttpService, useValue: { get: jest.fn(), post: jest.fn() } },
      ],
    }).compile();
    const svc = moduleRef.get(HcmService);
    const http = moduleRef.get(HttpService) as any;
    http.post.mockReturnValue(of({ data: { referenceId: 'ref_1' } }));
    const out = await svc.deductDays({
      employeeId: 'emp_123',
      locationId: 'loc_nyc',
      leaveType: 'annual',
      days: 1,
    });
    expect(out.hcmReferenceId).toBe('ref_1');
  });

  it('getBalance throws HcmUnreachableError when request fails', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        HcmService,
        { provide: HttpService, useValue: { get: jest.fn(), post: jest.fn() } },
      ],
    }).compile();
    const svc = moduleRef.get(HcmService);
    const http = moduleRef.get(HttpService) as any;
    http.get.mockReturnValue(throwError(() => new Error('boom')));
    await expect(svc.getBalance('emp_1', 'loc_1', 'annual')).rejects.toBeInstanceOf(HcmUnreachableError);
  });

  it('restoreDays succeeds on ok response', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        HcmService,
        { provide: HttpService, useValue: { get: jest.fn(), post: jest.fn() } },
      ],
    }).compile();
    const svc = moduleRef.get(HcmService);
    const http = moduleRef.get(HttpService) as any;
    http.post.mockReturnValue(of({ data: { ok: true } }));
    await expect(
      svc.restoreDays({ employeeId: 'emp_123', locationId: 'loc_nyc', leaveType: 'annual', days: 1 }),
    ).resolves.toBeUndefined();
  });

  it('restoreDays throws HcmUnreachableError on network error', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        HcmService,
        { provide: HttpService, useValue: { get: jest.fn(), post: jest.fn() } },
      ],
    }).compile();
    const svc = moduleRef.get(HcmService);
    const http = moduleRef.get(HttpService) as any;
    http.post.mockReturnValue(throwError(() => ({ code: 'ECONNREFUSED' })));
    await expect(
      svc.restoreDays({ employeeId: 'emp_123', locationId: 'loc_nyc', leaveType: 'annual', days: 1 }),
    ).rejects.toBeInstanceOf(HcmUnreachableError);
  });

  it('deductDays throws HcmUnreachableError on timeout', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        HcmService,
        { provide: HttpService, useValue: { get: jest.fn(), post: jest.fn() } },
      ],
    }).compile();
    const svc = moduleRef.get(HcmService);
    const http = moduleRef.get(HttpService) as any;
    http.post.mockReturnValue(throwError(() => ({ code: 'ECONNABORTED', message: 'timeout' })));
    await expect(
      svc.deductDays({ employeeId: 'emp_123', locationId: 'loc_nyc', leaveType: 'annual', days: 1 }),
    ).rejects.toBeInstanceOf(HcmUnreachableError);
  });

  it('deductDays throws HcmUnreachableError when error has no response/code', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        HcmService,
        { provide: HttpService, useValue: { get: jest.fn(), post: jest.fn() } },
      ],
    }).compile();
    const svc = moduleRef.get(HcmService);
    const http = moduleRef.get(HttpService) as any;
    http.post.mockReturnValue(throwError(() => ({ message: 'weird' })));
    await expect(
      svc.deductDays({ employeeId: 'emp_123', locationId: 'loc_nyc', leaveType: 'annual', days: 1 }),
    ).rejects.toBeInstanceOf(HcmUnreachableError);
  });

  it('restoreDays throws Error with message on HCM 422 response', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        HcmService,
        { provide: HttpService, useValue: { get: jest.fn(), post: jest.fn() } },
      ],
    }).compile();
    const svc = moduleRef.get(HcmService);
    const http = moduleRef.get(HttpService) as any;
    http.post.mockReturnValue(
      throwError(() => ({ response: { status: 422, data: { message: 'restore invalid' } } })),
    );
    await expect(
      svc.restoreDays({ employeeId: 'emp_123', locationId: 'loc_nyc', leaveType: 'annual', days: 1 }),
    ).rejects.toThrow('restore invalid');
  });

  it('restoreDays uses default message when response lacks message', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        HcmService,
        { provide: HttpService, useValue: { get: jest.fn(), post: jest.fn() } },
      ],
    }).compile();
    const svc = moduleRef.get(HcmService);
    const http = moduleRef.get(HttpService) as any;
    http.post.mockReturnValue(throwError(() => ({ response: { status: 422, data: {} } })));
    await expect(
      svc.restoreDays({ employeeId: 'emp_123', locationId: 'loc_nyc', leaveType: 'annual', days: 1 }),
    ).rejects.toThrow('HCM restore failed');
  });
});

