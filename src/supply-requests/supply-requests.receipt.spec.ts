import { NotFoundException } from '@nestjs/common';
import { SupplyRequestsService } from './supply-requests.service';
import {
  SupplyLineStatus,
  SupplyRequestStatus,
} from './schemas/supply-request.schema';
import { PermissionUser } from '../common/utils/permission.util';

const L = SupplyLineStatus;
const S = SupplyRequestStatus;

describe('SupplyRequestsService.getReceipt per-line statuses', () => {
  let service: SupplyRequestsService;
  let requests: Map<string, any>;
  let assetsService: { requiresAssetTagForCatalog: jest.Mock };

  const requester: PermissionUser = {
    userId: 'requester-1',
    permissions: [{ module: 'supplies', actions: ['read'] }],
  };
  const stranger: PermissionUser = {
    userId: 'stranger-1',
    permissions: [{ module: 'supplies', actions: ['read'] }],
  };

  const makeRequest = (items: any[], over: Record<string, any> = {}) => {
    const request: any = {
      _id: 'SR001',
      requestedBy: 'requester-1',
      status: S.APPROVED,
      items,
      toObject() {
        return {
          _id: this._id,
          requestedBy: this.requestedBy,
          status: this.status,
          items: this.items.map((i: any) => ({ ...i })),
          readyToCollectAt: this.readyToCollectAt,
        };
      },
      ...over,
    };
    requests.set('SR001', request);
    return request;
  };

  const line = (name: string, lineStatus?: SupplyLineStatus, over = {}) => ({
    name,
    quantity: 1,
    reason: 'needed',
    ...(lineStatus ? { lineStatus } : {}),
    ...over,
  });

  beforeEach(() => {
    requests = new Map();
    assetsService = {
      requiresAssetTagForCatalog: jest.fn(async (id?: string) => !!id),
    };
    const chain = (value: any) => {
      const q: any = {
        populate: jest.fn(() => q),
        exec: jest.fn(() => Promise.resolve(value)),
      };
      return q;
    };
    const requestModel: any = {
      findById: jest.fn((id: string) => chain(requests.get(String(id)) ?? null)),
    };

    service = new SupplyRequestsService(
      requestModel,
      {} as any,
      { log: jest.fn() } as any,
      {} as any,
      {} as any,
      assetsService as any,
      {} as any,
      {} as any,
      {} as any,
    );
    jest
      .spyOn(service as any, 'attachPurchaseStatus')
      .mockImplementation(async (list: any) => list);
  });

  it('marks only ready lines as collectable and counts them', async () => {
    makeRequest([
      line('PC', L.READY, { catalogItemId: 'SC-PC' }),
      line('Tablet', L.ON_ORDER, { catalogItemId: 'SC-TAB' }),
      line('Mouse', L.REJECTED),
      line('Cable', L.COLLECTED),
    ]);

    const receipt: any = await service.getReceipt('SR001', requester);

    expect(receipt.lineMode).toBe(true);
    expect(receipt.readyLineCount).toBe(1);
    expect(receipt.items.map((i: any) => i.collectable)).toEqual([
      true,
      false,
      false,
      false,
    ]);
    expect(receipt.items.map((i: any) => i.lineStatus)).toEqual([
      L.READY,
      L.ON_ORDER,
      L.REJECTED,
      L.COLLECTED,
    ]);
  });

  it('shows ready to collect and allows confirming while another line is still on order', async () => {
    makeRequest([
      line('PC', L.READY, { catalogItemId: 'SC-PC' }),
      line('Tablet', L.ON_ORDER, { catalogItemId: 'SC-TAB' }),
    ]);

    const receipt: any = await service.getReceipt('SR001', requester);

    expect(receipt.waitingForPurchase).toBe(false);
    expect(receipt.readyToCollect).toBe(true);
    expect(receipt.canConfirm).toBe(true);
  });

  it('does not show ready to collect when every open line is still on order', async () => {
    makeRequest(
      [
        line('PC', L.ON_ORDER, { catalogItemId: 'SC-PC' }),
        line('Tablet', L.ON_ORDER, { catalogItemId: 'SC-TAB' }),
      ],
      { status: S.ORDERED },
    );

    const receipt: any = await service.getReceipt('SR001', requester);

    expect(receipt.readyLineCount).toBe(0);
    expect(receipt.readyToCollect).toBe(false);
    expect(receipt.canConfirm).toBe(false);
  });

  it('keeps ready lines collectable after a partial pickup', async () => {
    makeRequest(
      [
        line('PC', L.COLLECTED, { catalogItemId: 'SC-PC' }),
        line('Tablet', L.READY, { catalogItemId: 'SC-TAB' }),
      ],
      { status: S.PARTIALLY_RECEIVED },
    );

    const receipt: any = await service.getReceipt('SR001', requester);

    expect(receipt.readyToCollect).toBe(true);
    expect(receipt.canConfirm).toBe(true);
    expect(receipt.items.map((i: any) => i.collectable)).toEqual([false, true]);
  });

  it('does not allow confirming a closed request', async () => {
    makeRequest(
      [line('PC', L.COLLECTED), line('Mouse', L.REJECTED)],
      { status: S.CLOSED },
    );

    const receipt: any = await service.getReceipt('SR001', requester);

    expect(receipt.readyToCollect).toBe(false);
    expect(receipt.canConfirm).toBe(false);
  });

  it('keeps old requests without line statuses collectable as a whole', async () => {
    makeRequest(
      [line('PC', undefined, { catalogItemId: 'SC-PC' }), line('Tablet')],
      { readyToCollectAt: new Date() },
    );

    const receipt: any = await service.getReceipt('SR001', requester);

    expect(receipt.lineMode).toBe(false);
    expect(receipt.items.map((i: any) => i.collectable)).toEqual([true, true]);
    expect(receipt.readyToCollect).toBe(true);
    expect(receipt.canConfirm).toBe(true);
  });

  it('still blocks an old request while a linked purchase has not fully arrived', async () => {
    makeRequest(
      [
        line('PC', undefined, {
          catalogItemId: 'SC-PC',
          purchaseRequestId: 'PR001',
          purchaseQty: 2,
          arrivedQty: 1,
        }),
      ],
      { readyToCollectAt: new Date() },
    );

    const receipt: any = await service.getReceipt('SR001', requester);

    expect(receipt.lineMode).toBe(false);
    expect(receipt.waitingForPurchase).toBe(true);
    expect(receipt.readyToCollect).toBe(false);
    expect(receipt.canConfirm).toBe(false);
  });

  it('hides the receipt from a user who is not involved in the request', async () => {
    makeRequest([line('PC', L.READY)]);

    await expect(
      service.getReceipt('SR001', stranger),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
