import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { InventoryGateway } from './inventory.gateway';
import { InventoryChangeInterceptor } from './inventory-change.interceptor';

@Global()
@Module({
  providers: [
    InventoryGateway,
    { provide: APP_INTERCEPTOR, useClass: InventoryChangeInterceptor },
  ],
  exports: [InventoryGateway],
})
export class RealtimeModule {}
