import { IsIn, IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';

export class CreateRequestDto {
  @IsString()
  @IsNotEmpty()
  employeeId!: string;

  @IsString()
  @IsNotEmpty()
  locationId!: string;

  @IsString()
  @IsIn(['annual', 'sick', 'personal'])
  leaveType!: 'annual' | 'sick' | 'personal';

  @IsString()
  @IsNotEmpty()
  startDate!: string; // YYYY-MM-DD

  @IsString()
  @IsNotEmpty()
  endDate!: string; // YYYY-MM-DD

  @IsNumber()
  @Min(0.5)
  daysRequested!: number;
}

