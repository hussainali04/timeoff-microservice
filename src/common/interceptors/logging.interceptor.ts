import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request & { ip?: string }>();
    const { method, url } = (req ?? {}) as { method?: string; url?: string };
    const ip = (req as any)?.ip ?? 'unknown';
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const res = http.getResponse<{ statusCode?: number }>();
          const statusCode = (res as any)?.statusCode;
          this.logger.log(
            `${method ?? 'N/A'} ${url ?? 'N/A'} ${statusCode ?? 'N/A'} - ${Date.now() - start}ms - ip=${ip}`,
          );
        },
        error: () => {
          const res = http.getResponse<{ statusCode?: number }>();
          const statusCode = (res as any)?.statusCode;
          this.logger.warn(
            `${method ?? 'N/A'} ${url ?? 'N/A'} ${statusCode ?? 'N/A'} - ${Date.now() - start}ms - ip=${ip}`,
          );
        },
      }),
    );
  }
}

