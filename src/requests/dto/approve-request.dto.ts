import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ApproveRequestDto {
  @IsString()
  @IsNotEmpty()
  managerId!: string;

  @IsString()
  @IsOptional()
  managerNote?: string;
}

