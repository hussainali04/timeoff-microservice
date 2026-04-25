import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class SyncBalanceRecordDto {
  @IsString()
  @IsNotEmpty()
  employeeId!: string;

  @IsString()
  @IsNotEmpty()
  locationId!: string;

  @IsString()
  @IsIn(['annual', 'sick', 'personal'])
  leaveType!: 'annual' | 'sick' | 'personal';

  @IsNumber()
  @Min(0)
  totalDays!: number;
}

export class SyncBalancesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SyncBalanceRecordDto)
  records!: SyncBalanceRecordDto[];
}

