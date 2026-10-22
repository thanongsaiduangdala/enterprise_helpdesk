import { SupplyRequestsService } from './supply-requests.service';
import { SupplyRequestStatus } from './schemas/supply-request.schema';
import { PoprItemType, PoprStatus } from '../popr/schemas/popr-record.schema';

/**
 * ທົດສອບການຄຳນວນສະຖານະ SR ຈາກ POPR:
 * ບໍ່ມີຮັບ → ORDERED, ຮັບບາງສ່ວນ → PARTIALLY_RECEIVED, ຮັບຄົບ → CLOSED
 * (ນັບຕາມຈຳນວນທີ່ຮັບຈິງ ບໍ່ແມ່ນຈຳນວນ index ລາຍການ)
 */
describe('SupplyRequestsService.recomputeStatus', () => {
  const makeRequest = (
    status: SupplyRequestStatus,
    items: any[],
    extra: Record<string, any> = {},
  ) => {
    const request: any = {
      status,
      items,
      requestedBy: 'u1',
      fulfilledAt: undefined,
      fulfilledBy: undefined,
      set: jest.fn((key: string, value: any) => {
        request[key] = value;
        return request;
      }),
      save: jest.fn().mockImplementation(function (this: any) {
        return Promise.resolve(this);
      }),
      ...extra,
    };
    return request;
  };

  /** POPR ທີ່ຮັບຄົບຕາມຈຳນວນ (non-consumable = ຈຳນວນສັ່ງຂອງງວດ) */
  const completedPopr = (index: number, quantity = 1, extra: any = {}) => ({
    status: PoprStatus.COMPLETED,
    supplyRequestItemIndex: index,
    itemType: PoprItemType.ELECTRONIC,
    procurement: { quantity },
    receiving: { units: [{ serialNumber: `SN-${index}-${quantity}` }] },
    poClosedShort: false,
    ...extra,
  });

  const build = (request: any, poprs: any[]) => {
    const requestModel = {
      findById: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(request),
      }),
    };
    const poprModel = {
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(poprs),
        }),
      }),
    };
    const auditLogsService = { log: jest.fn() };
    const service = new SupplyRequestsService(
      requestModel as any,
      poprModel as any,
      {} as any,
      auditLogsService as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return { service, requestModel, poprModel, auditLogsService };
  };

  it('moves APPROVED → ORDERED when a POPR exists but none received', async () => {
    const request = makeRequest(SupplyRequestStatus.APPROVED, [
      { name: 'A', quantity: 1 },
    ]);
    const { service } = build(request, [
      { status: PoprStatus.IN_PROGRESS, supplyRequestItemIndex: 0 },
    ]);
    await service.recomputeStatus('SR001');
    expect(request.status).toBe(SupplyRequestStatus.ORDERED);
  });

  it('moves → PARTIALLY_RECEIVED when only some item lines complete', async () => {
    const request = makeRequest(SupplyRequestStatus.APPROVED, [
      { name: 'A', quantity: 1 },
      { name: 'B', quantity: 1 },
    ]);
    const { service } = build(request, [
      completedPopr(0),
      { status: PoprStatus.IN_PROGRESS, supplyRequestItemIndex: 1 },
    ]);
    await service.recomputeStatus('SR001');
    expect(request.status).toBe(SupplyRequestStatus.PARTIALLY_RECEIVED);
  });

  it('moves → CLOSED when ALL item lines complete', async () => {
    const request = makeRequest(SupplyRequestStatus.APPROVED, [
      { name: 'A', quantity: 1 },
      { name: 'B', quantity: 1 },
    ]);
    const { service } = build(request, [completedPopr(0), completedPopr(1)]);
    await service.recomputeStatus('SR001');
    expect(request.status).toBe(SupplyRequestStatus.CLOSED);
    expect(request.fulfilledAt).toBeInstanceOf(Date);
  });

  it('never overrides a REJECTED request', async () => {
    const request = makeRequest(SupplyRequestStatus.REJECTED, [
      { name: 'A', quantity: 1 },
    ]);
    const { service } = build(request, [completedPopr(0)]);
    await service.recomputeStatus('SR001');
    expect(request.status).toBe(SupplyRequestStatus.REJECTED);
  });

  it('never overrides an un-approved REQUESTED request', async () => {
    const request = makeRequest(SupplyRequestStatus.REQUESTED, [
      { name: 'A', quantity: 1 },
    ]);
    const { service } = build(request, []);
    await service.recomputeStatus('SR001');
    expect(request.status).toBe(SupplyRequestStatus.REQUESTED);
  });

  it('never revives a CANCELLED request (status outside the enum)', async () => {
    const request = makeRequest('CANCELLED' as SupplyRequestStatus, [
      { name: 'A', quantity: 1 },
    ]);
    const { service } = build(request, [completedPopr(0)]);
    await service.recomputeStatus('SR001');
    expect(request.status).toBe('CANCELLED');
  });

  it('does not close a line that is only partially received (quantity-aware)', async () => {
    const request = makeRequest(SupplyRequestStatus.APPROVED, [
      { name: 'A', quantity: 3 },
    ]);
    const { service } = build(request, [completedPopr(0, 2)]);
    await service.recomputeStatus('SR001');
    expect(request.status).toBe(SupplyRequestStatus.PARTIALLY_RECEIVED);
    expect(request.fulfilledAt).toBeUndefined();
  });

  it('closes a line when several POPRs together cover the ordered quantity', async () => {
    const request = makeRequest(SupplyRequestStatus.APPROVED, [
      { name: 'A', quantity: 3 },
    ]);
    const { service } = build(request, [
      completedPopr(0, 2),
      completedPopr(0, 1, {
        procurement: { quantity: 1 },
        receiving: { units: [{ serialNumber: 'SN-0-1b' }] },
      }),
    ]);
    await service.recomputeStatus('SR001');
    expect(request.status).toBe(SupplyRequestStatus.CLOSED);
  });

  it('ignores a PO closed short (no goods were received)', async () => {
    const request = makeRequest(SupplyRequestStatus.APPROVED, [
      { name: 'A', quantity: 1 },
    ]);
    const { service } = build(request, [
      completedPopr(0, 1, { poClosedShort: true }),
    ]);
    await service.recomputeStatus('SR001');
    expect(request.status).toBe(SupplyRequestStatus.ORDERED);
  });

  it('ignores a completed POPR that is not linked to an item line', async () => {
    const request = makeRequest(SupplyRequestStatus.APPROVED, [
      { name: 'A', quantity: 1 },
    ]);
    const { service } = build(request, [
      {
        status: PoprStatus.COMPLETED,
        itemType: PoprItemType.ELECTRONIC,
        procurement: { quantity: 1 },
        receiving: { units: [{ serialNumber: 'SN-x' }] },
        poClosedShort: false,
      },
    ]);
    await service.recomputeStatus('SR001');
    expect(request.status).toBe(SupplyRequestStatus.ORDERED);
  });

  it('never downgrades a request that was already received (fulfilledBy set)', async () => {
    const request = makeRequest(
      SupplyRequestStatus.CLOSED,
      [{ name: 'A', quantity: 1 }],
      { fulfilledBy: 'staff-1' },
    );
    const { service } = build(request, []);
    await service.recomputeStatus('SR001');
    expect(request.status).toBe(SupplyRequestStatus.CLOSED);
  });

  it('never downgrades a legacy FULFILLED request', async () => {
    const request = makeRequest(SupplyRequestStatus.FULFILLED, [
      { name: 'A', quantity: 1 },
    ]);
    const { service } = build(request, []);
    await service.recomputeStatus('SR001');
    expect(request.status).toBe(SupplyRequestStatus.FULFILLED);
  });

  it('clears fulfilledAt when the request falls back to partially received', async () => {
    const request = makeRequest(
      SupplyRequestStatus.CLOSED,
      [{ name: 'A', quantity: 1 }],
      { fulfilledAt: new Date() },
    );
    const { service } = build(request, []);
    await service.recomputeStatus('SR001');
    expect(request.status).toBe(SupplyRequestStatus.ORDERED);
    expect(request.fulfilledAt).toBeUndefined();
  });
});
