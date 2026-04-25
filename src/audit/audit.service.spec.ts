import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuditService } from './audit.service';
import { AuditLog } from './audit-log.entity';

describe('AuditService', () => {
  it('write saves JSON metadata and returns saved entity', async () => {
    const repo = {
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => ({ ...x, id: 1 })),
      find: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: getRepositoryToken(AuditLog), useValue: repo },
      ],
    }).compile();

    const svc = moduleRef.get(AuditService);
    const saved = await svc.write({
      entityType: 'request',
      entityId: 'req_1',
      action: 'approved',
      deltaDays: 1,
      source: 'manager_action',
      performedBy: 'mgr_1',
      metadata: { a: 1 },
    });
    expect(saved.id).toBe(1);
    expect(repo.save).toHaveBeenCalled();
  });

  it('findByEntityId queries repository ordered by id', async () => {
    const repo = {
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(async () => [{ id: 1 }]),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: getRepositoryToken(AuditLog), useValue: repo },
      ],
    }).compile();
    const svc = moduleRef.get(AuditService);
    const out = await svc.findByEntityId('x');
    expect(out[0].id).toBe(1);
    expect(repo.find).toHaveBeenCalledWith({
      where: { entity_id: 'x' },
      order: { id: 'ASC' },
    });
  });

  it('write stores null metadata when not provided', async () => {
    const repo = {
      create: jest.fn((x) => x),
      save: jest.fn(async (x) => x),
      find: jest.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: getRepositoryToken(AuditLog), useValue: repo },
      ],
    }).compile();
    const svc = moduleRef.get(AuditService);
    const out = await svc.write({
      entityType: 'balance',
      entityId: '1',
      action: 'batch_synced',
      source: 'hcm_batch',
    } as any);
    expect(out.metadata).toBeNull();
  });
});

