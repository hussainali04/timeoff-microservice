import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditAction, AuditEntityType, AuditLog, AuditSource } from './audit-log.entity';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly repo: Repository<AuditLog>,
  ) {}

  async write(input: {
    entityType: AuditEntityType;
    entityId: string;
    action: AuditAction;
    deltaDays?: number | null;
    source: AuditSource;
    performedBy?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<AuditLog> {
    const entry = this.repo.create({
      entity_type: input.entityType,
      entity_id: input.entityId,
      action: input.action,
      delta_days: input.deltaDays ?? null,
      source: input.source,
      performed_by: input.performedBy ?? null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    });
    const saved = await this.repo.save(entry);
    this.logger.log(
      `audit entity=${saved.entity_type}:${saved.entity_id} action=${saved.action} source=${saved.source}`,
    );
    return saved;
  }

  async findByEntityId(entityId: string): Promise<AuditLog[]> {
    return this.repo.find({
      where: { entity_id: entityId },
      order: { id: 'ASC' },
    });
  }
}

