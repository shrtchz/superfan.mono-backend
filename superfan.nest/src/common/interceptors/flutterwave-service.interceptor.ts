import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { tap } from 'rxjs/operators';
import { prisma } from '../../prisma/prisma';


@Injectable()
export class FlutterwaveSyncInterceptor implements NestInterceptor {
  async updateLastSync() {

    let processor_Id = await prisma.paymentProcessor.findFirst({
        where: { name: 'flutterwave' },

    });
    
    await prisma.paymentProcessor.update({
  where: { id: processor_Id.id },
  data: { lastSync: new Date() }, // ✅ correct
});
  }

  intercept(context: ExecutionContext, next: CallHandler) {
    return next.handle().pipe(
      tap(async () => {
        await this.updateLastSync();
      }),
    );
  }
}