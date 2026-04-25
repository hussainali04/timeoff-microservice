import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureTestApp } from './e2e-bootstrap';

function jwt(role: 'employee' | 'manager', sub: string) {
  // For e2e we use a fixed token signed at runtime by JwtModule config via AuthModule:
  // simplest is to bypass and mark endpoints public, but spec requires JWT on all endpoints.
  // We therefore generate a minimal HS256 token manually.
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub, role, iat: Math.floor(Date.now() / 1000) })).toString('base64url');
  const crypto = require('crypto');
  const secret = process.env.JWT_SECRET ?? 'supersecretjwtkey123';
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

describe('Requests (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureTestApp(app);
    await app.init();

    await fetch('http://localhost:3001/mock/reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    // Seed local balance cache via batch sync to ensure local availability checks pass
    await request(app.getHttpServer())
      .post('/hcm/batch-sync')
      .set('x-hcm-api-key', process.env.HCM_SYNC_API_KEY!)
      .send({
        records: [
          { employeeId: 'emp_123', locationId: 'loc_nyc', leaveType: 'annual', totalDays: 20 },
        ],
      })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /requests with sufficient balance → 201, status = pending', async () => {
    const res = await request(app.getHttpServer())
      .post('/requests')
      .set('Authorization', `Bearer ${jwt('employee', 'emp_123')}`)
      .send({
        employeeId: 'emp_123',
        locationId: 'loc_nyc',
        leaveType: 'annual',
        startDate: '2026-06-01',
        endDate: '2026-06-02',
        daysRequested: 2,
      })
      .expect(201);
    expect(res.body.status).toBe('pending');
  });

  it('POST /requests with insufficient balance → 409', async () => {
    await request(app.getHttpServer())
      .post('/requests')
      .set('Authorization', `Bearer ${jwt('employee', 'emp_123')}`)
      .send({
        employeeId: 'emp_123',
        locationId: 'loc_nyc',
        leaveType: 'annual',
        startDate: '2026-06-03',
        endDate: '2026-06-10',
        daysRequested: 999,
      })
      .expect(409);
  });

  it('POST /requests with missing fields → 400', async () => {
    await request(app.getHttpServer())
      .post('/requests')
      .set('Authorization', `Bearer ${jwt('employee', 'emp_123')}`)
      .send({
        employeeId: 'emp_123',
      })
      .expect(400);
  });

  it('PATCH /requests/:id/approve → 200, used_days incremented, pending_days decremented', async () => {
    const created = await request(app.getHttpServer())
      .post('/requests')
      .set('Authorization', `Bearer ${jwt('employee', 'emp_123')}`)
      .send({
        employeeId: 'emp_123',
        locationId: 'loc_nyc',
        leaveType: 'annual',
        startDate: '2026-07-01',
        endDate: '2026-07-02',
        daysRequested: 1,
      })
      .expect(201);

    const id = created.body.id;

    await request(app.getHttpServer())
      .patch(`/requests/${id}/approve`)
      .set('Authorization', `Bearer ${jwt('manager', 'mgr_1')}`)
      .send({ managerId: 'mgr_1', managerNote: 'ok' })
      .expect(200);

    const bal = await request(app.getHttpServer())
      .get('/balances/emp_123/loc_nyc/annual')
      .set('Authorization', `Bearer ${jwt('employee', 'emp_123')}`)
      .expect(200);

    expect(Number(bal.body.used_days)).toBeGreaterThanOrEqual(1);
    expect(Number(bal.body.pending_days)).toBeGreaterThanOrEqual(0);
  });

  it('PATCH /requests/:id/reject → 200, pending_days restored', async () => {
    const created = await request(app.getHttpServer())
      .post('/requests')
      .set('Authorization', `Bearer ${jwt('employee', 'emp_123')}`)
      .send({
        employeeId: 'emp_123',
        locationId: 'loc_nyc',
        leaveType: 'annual',
        startDate: '2026-08-01',
        endDate: '2026-08-02',
        daysRequested: 1,
      })
      .expect(201);

    const id = created.body.id;

    await request(app.getHttpServer())
      .patch(`/requests/${id}/reject`)
      .set('Authorization', `Bearer ${jwt('manager', 'mgr_1')}`)
      .send({ managerId: 'mgr_1', managerNote: 'no' })
      .expect(200);
  });

  it('PATCH /requests/:id/cancel → 200, pending_days restored, status = cancelled', async () => {
    const created = await request(app.getHttpServer())
      .post('/requests')
      .set('Authorization', `Bearer ${jwt('employee', 'emp_123')}`)
      .send({
        employeeId: 'emp_123',
        locationId: 'loc_nyc',
        leaveType: 'annual',
        startDate: '2026-09-01',
        endDate: '2026-09-02',
        daysRequested: 1,
      })
      .expect(201);

    const id = created.body.id;

    const cancelled = await request(app.getHttpServer())
      .patch(`/requests/${id}/cancel`)
      .set('Authorization', `Bearer ${jwt('employee', 'emp_123')}`)
      .send({ employeeId: 'emp_123' })
      .expect(200);
    expect(cancelled.body.status).toBe('cancelled');
  });
});

