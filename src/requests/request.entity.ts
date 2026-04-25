import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { LeaveType } from '../balances/balance.entity';

export type RequestStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'cancelled'
  | 'pending_hcm_confirmation'
  | 'needs_manual_review';

@Entity({ name: 'time_off_requests' })
export class TimeOffRequest {
  @PrimaryColumn({ type: 'text' })
  id!: string; // UUID

  @Column({ type: 'text' })
  employee_id!: string;

  @Column({ type: 'text' })
  location_id!: string;

  @Column({ type: 'text' })
  leave_type!: LeaveType;

  @Column({ type: 'date' })
  start_date!: string;

  @Column({ type: 'date' })
  end_date!: string;

  @Column({ type: 'real' })
  days_requested!: number;

  @Column({ type: 'text' })
  status!: RequestStatus;

  @Column({ type: 'text', nullable: true })
  manager_id!: string | null;

  @Column({ type: 'text', nullable: true })
  manager_note!: string | null;

  @Column({ type: 'text', nullable: true })
  hcm_reference_id!: string | null;

  @CreateDateColumn({ type: 'datetime' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updated_at!: Date;
}

