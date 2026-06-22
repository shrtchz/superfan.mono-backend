// econnreset.filter.ts
import { ArgumentsHost, Catch, ExceptionFilter, Logger } from '@nestjs/common';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: any, host: ArgumentsHost) {
    if (exception?.code === 'ECONNRESET') {
      this.logger.warn('ECONNRESET — client disconnected early, ignoring.');
      return;
    }
    throw exception;
  }
}