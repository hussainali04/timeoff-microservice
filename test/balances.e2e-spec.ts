import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureTestApp } from './e2e-bootstrap';

function jwt(role: 'employee' | 'manager', sub: string) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub, role, iat: Math.floor(Date.now() / 1000) })).toString('base64url');
  const crypto = require('crypto');
  const secret = process.env.JWT_SECRET ?? 'supersecretjwtkey123';
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

describe('Balances (e2e)', () => {
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

    await request(app.getHttpServer())
      .post('/hcm/batch-sync')
      .set('x-hcm-api-key', process.env.HCM_SYNC_API_KEY!)
      .send({
        records: [
          { employeeId: 'emp_123', locationId: 'loc_nyc', leaveType: 'annual', totalDays: 20 },
        ],
      });
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /balances/:employeeId/:locationId/:leaveType when stale → balance refreshed from HCM', async () => {
    process.env.BALANCE_TTL_MINUTES = '0';
    const res = await request(app.getHttpServer())
      .get('/balances/emp_123/loc_nyc/annual')
      .set('Authorization', `Bearer ${jwt('employee', 'emp_123')}`)
      .expect(200);
    expect(res.body.employee_id).toBe('emp_123');
  });

  it('POST /hcm/batch-sync with valid API key → 201, all balances upserted', async () => {
    const res = await request(app.getHttpServer())
      .post('/hcm/batch-sync')
      .set('x-hcm-api-key', process.env.HCM_SYNC_API_KEY!)
      .send({
        records: [
          { employeeId: 'emp_456', locationId: 'loc_lax', leaveType: 'annual', totalDays: 15 },
          { employeeId: 'emp_456', locationId: 'loc_lax', leaveType: 'sick', totalDays: 10 },
        ],
      })
      .expect(201);
    expect(res.body.synced).toBe(2);
  });

  it('POST /hcm/batch-sync without API key → 401', async () => {
    await request(app.getHttpServer())
      .post('/hcm/batch-sync')
      .send({
        records: [{ employeeId: 'emp_456', locationId: 'loc_lax', leaveType: 'annual', totalDays: 15 }],
      })
      .expect(401);
  });
});

