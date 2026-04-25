import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type AuditEntityType = 'balance' | 'request';
export type AuditAction =
  | 'deducted'
  | 'restored'
  | 'batch_synced'
  | 'approved'
  | 'rejected'
  | 'cancelled';
export type AuditSource =
  | 'employee_request'
  | 'manager_action'
  | 'hcm_batch'
  | 'hcm_realtime'
  | 'system_reconciliation';

@Entity({ name: 'audit_log' })
export class AuditLog {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text' })
  entity_type!: AuditEntityType;

  @Column({ type: 'text' })
  entity_id!: string;

  @Column({ type: 'text' })
  action!: AuditAction;

  @Column({ type: 'real', nullable: true })
  delta_days!: number | null;

  @Column({ type: 'text' })
  source!: AuditSource;

  @Column({ type: 'text', nullable: true })
  performed_by!: string | null;

  @Column({ type: 'text', nullable: true })
  metadata!: string | null;

  @CreateDateColumn({ type: 'datetime' })
  created_at!: Date;
}

