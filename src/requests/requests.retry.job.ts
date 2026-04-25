import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RequestsService } from './requests.service';

@Injectable()
export class RequestsRetryJob {
  private readonly logger = new Logger(RequestsRetryJob.name);

  constructor(private readonly requests: RequestsService) {}

  @Cron('*/15 * * * *')
  async run(): Promise<void> {
    try {
      const processed = await this.requests.retryPendingHcmConfirmation();
      if (processed > 0) {
        this.logger.log(`Retry job processed=${processed}`);
      }
    } catch (e: any) {
      this.logger.error(`Retry job failed: ${e?.message ?? e}`);
    }
  }
}

