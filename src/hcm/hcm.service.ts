import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

export class HcmUnreachableError extends Error {
  constructor(message = 'HCM unreachable') {
    super(message);
  }
}

@Injectable()
export class HcmService {
  private readonly logger = new Logger(HcmService.name);
  private readonly baseUrl = process.env.HCM_BASE_URL ?? 'http://localhost:3001';

  constructor(private readonly http: HttpService) {}

  async getBalance(employeeId: string, locationId: string, leaveType: string): Promise<{ totalDays: number }> {
    try {
      const res = await firstValueFrom(
        this.http.get(`${this.baseUrl}/hcm/balance/${employeeId}/${locationId}/${leaveType}`, {
          timeout: 2500,
        }),
      );
      return { totalDays: Number(res.data?.balance ?? 0) };
    } catch (e: any) {
      this.logger.warn(`HCM getBalance failed: ${e?.message ?? e}`);
      throw new HcmUnreachableError();
    }
  }

  async deductDays(input: {
    employeeId: string;
    locationId: string;
    leaveType: string;
    days: number;
  }): Promise<{ hcmReferenceId?: string }> {
    try {
      const res = await firstValueFrom(
        this.http.post(
          `${this.baseUrl}/hcm/balance/deduct`,
          {
            employeeId: input.employeeId,
            locationId: input.locationId,
            leaveType: input.leaveType,
            days: input.days,
          },
          { timeout: 2500 },
        ),
      );
      return { hcmReferenceId: res.data?.referenceId };
    } catch (e: any) {
      if (e?.code === 'ECONNABORTED' || e?.code === 'ECONNREFUSED') {
        this.logger.warn(`HCM deduct unreachable: ${e?.message ?? e}`);
        throw new HcmUnreachableError();
      }
      if (e?.response) {
        const status = e.response.status;
        const message = e.response.data?.message ?? 'HCM validation failed';
        const err = new Error(message);
        (err as any).status = status;
        throw err;
      }
      throw new HcmUnreachableError();
    }
  }

  async restoreDays(input: {
    employeeId: string;
    locationId: string;
    leaveType: string;
    days: number;
  }): Promise<void> {
    try {
      await firstValueFrom(
        this.http.post(
          `${this.baseUrl}/hcm/balance/restore`,
          {
            employeeId: input.employeeId,
            locationId: input.locationId,
            leaveType: input.leaveType,
            days: input.days,
          },
          { timeout: 2500 },
        ),
      );
    } catch (e: any) {
      if (e?.response) {
        const message = e.response.data?.message ?? 'HCM restore failed';
        const err = new Error(message);
        (err as any).status = e.response.status;
        throw err;
      }
      this.logger.warn(`HCM restore unreachable: ${e?.message ?? e}`);
      throw new HcmUnreachableError();
    }
  }
}

