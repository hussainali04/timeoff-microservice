import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  HttpCode,
  Res,
} from '@nestjs/common';
import { RequestsService } from './requests.service';
import { CreateRequestDto } from './dto/create-request.dto';
import { ApproveRequestDto } from './dto/approve-request.dto';
import { RejectRequestDto } from './dto/reject-request.dto';
import { CancelRequestDto } from './dto/cancel-request.dto';
import { Roles } from '../auth/roles.decorator';
import type { RequestStatus } from './request.entity';
import type { Response } from 'express';

@Controller('requests')
export class RequestsController {
  constructor(private readonly requests: RequestsService) {}

  @Post()
  async create(@Body() dto: CreateRequestDto, @Res() res: Response) {
    const { request, httpStatus } = await this.requests.create(dto);
    return res.status(httpStatus).json(request);
  }

  @Get(':requestId')
  async getOne(@Param('requestId') requestId: string) {
    return this.requests.findOne(requestId);
  }

  @Get()
  async list(@Query('employeeId') employeeId?: string, @Query('status') status?: RequestStatus) {
    return this.requests.list({ employeeId, status });
  }

  @Roles('manager')
  @Patch(':requestId/approve')
  async approve(@Param('requestId') requestId: string, @Body() dto: ApproveRequestDto) {
    return this.requests.approve(requestId, dto);
  }

  @Roles('manager')
  @Patch(':requestId/reject')
  async reject(@Param('requestId') requestId: string, @Body() dto: RejectRequestDto) {
    return this.requests.reject(requestId, dto);
  }

  @Patch(':requestId/cancel')
  @HttpCode(200)
  async cancel(@Param('requestId') requestId: string, @Body() dto: CancelRequestDto) {
    return this.requests.cancel(requestId, dto.employeeId);
  }
}

