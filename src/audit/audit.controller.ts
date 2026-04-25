import { Controller, Get, Query } from '@nestjs/common';
import { AuditService } from './audit.service';

@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  async list(@Query('entityId') entityId?: string) {
    if (!entityId) return [];
    return this.audit.findByEntityId(entityId);
  }
}

