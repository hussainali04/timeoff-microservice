import { Controller, Get, Param } from '@nestjs/common';
import { BalancesService } from './balances.service';
import type { LeaveType } from './balance.entity';

@Controller('balances')
export class BalancesController {
  constructor(private readonly balances: BalancesService) {}

  @Get(':employeeId')
  async all(@Param('employeeId') employeeId: string) {
    return this.balances.getAllForEmployee(employeeId);
  }

  @Get(':employeeId/:locationId/:leaveType')
  async one(
    @Param('employeeId') employeeId: string,
    @Param('locationId') locationId: string,
    @Param('leaveType') leaveType: LeaveType,
  ) {
    const { balance, stale } = await this.balances.getOneWithStaleness(
      employeeId,
      locationId,
      leaveType,
    );
    return stale ? { ...balance, stale: true } : balance;
  }
}

