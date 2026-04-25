import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<{ status: (code: number) => any }>();
    const request = ctx.getRequest<{ method?: string; url?: string }>();

    const referenceId = `err_${randomUUID()}`;

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const responseBody = exception.getResponse();

      // For known HTTP exceptions, return sanitized payload (no stack traces)
      return response.status(statusCode).json({
        statusCode,
        error: HttpStatus[statusCode] ?? 'Error',
        message:
          typeof responseBody === 'string'
            ? responseBody
            : (responseBody as any)?.message ?? exception.message,
      });
    }

    this.logger.error(
      `Unhandled exception referenceId=${referenceId} ${request?.method ?? ''} ${request?.url ?? ''}`,
      exception instanceof Error ? exception.stack : undefined,
    );

    return response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'An unexpected error occurred.',
      referenceId,
    });
  }
}

