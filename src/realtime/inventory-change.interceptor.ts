import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { InventoryGateway } from './inventory.gateway';

/**
 * Controller ທີ່ການບັນທຶກ (POST/PUT/PATCH/DELETE) ສົ່ງຜົນຕໍ່ຂໍ້ມູນສາງ/ຊັບສິນ.
 * ການຮັບເຄື່ອງ → ປ່ຽນ stock + ຊັບສິນ + ສະຖານະຄຳຂໍ/ໃບສະເໜີຊື້ ພ້ອມກັນ, ຈຶ່ງຈັບທີ່ຊັ້ນ HTTP
 * ແທນທີ່ຈະໄປໃສ່ທຸກ service method (ຈະຕົກຫຼົ່ນງ່າຍ).
 */
export const INVENTORY_RESOURCES = new Set([
  'supply-requests',
  'supply-catalog',
  'assets',
  'goods-receipt',
  'purchase-requests',
  'maintenance-history',
]);

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

@Injectable()
export class InventoryChangeInterceptor implements NestInterceptor {
  private readonly logger = new Logger(InventoryChangeInterceptor.name);

  constructor(private readonly gateway: InventoryGateway) {}

  private resourceOf(req: any): string | null {
    if (!MUTATING_METHODS.has(String(req?.method ?? '').toUpperCase())) {
      return null;
    }
    const path = String(req?.originalUrl ?? req?.url ?? '').split('?')[0];
    const segments = path.split('/').filter(Boolean);
    if (segments[0] === 'api') segments.shift(); // global prefix
    const resource = segments[0];
    return resource && INVENTORY_RESOURCES.has(resource) ? resource : null;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') return next.handle();
    const resource = this.resourceOf(context.switchToHttp().getRequest());
    if (!resource) return next.handle();

    // ສົ່ງສະເພາະເມື່ອບັນທຶກສຳເລັດ (error ຈະບໍ່ເຂົ້າ tap.next)
    return next.handle().pipe(
      tap(() => {
        try {
          this.gateway.emitChanged(resource);
        } catch (err) {
          this.logger.warn(
            `inventory:changed emit failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }),
    );
  }
}
