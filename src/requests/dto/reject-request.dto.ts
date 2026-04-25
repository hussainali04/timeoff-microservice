import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class RejectRequestDto {
  @IsString()
  @IsNotEmpty()
  managerId!: string;

  @IsString()
  @IsOptional()
  managerNote?: string;
}

