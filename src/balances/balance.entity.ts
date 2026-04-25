import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type LeaveType = 'annual' | 'sick' | 'personal';

@Entity({ name: 'balances' })
@Index(['employee_id', 'location_id', 'leave_type'], { unique: true })
export class Balance {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'text' })
  employee_id!: string;

  @Column({ type: 'text' })
  location_id!: string;

  @Column({ type: 'text' })
  leave_type!: LeaveType;

  @Column({ type: 'real' })
  total_days!: number;

  @Column({ type: 'real', default: 0 })
  used_days!: number;

  @Column({ type: 'real', default: 0 })
  pending_days!: number;

  @Column({ type: 'integer', default: 1 })
  version!: number;

  @Column({ type: 'datetime', nullable: true })
  last_synced_at!: Date | null;

  @CreateDateColumn({ type: 'datetime' })
  created_at!: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updated_at!: Date;
}

