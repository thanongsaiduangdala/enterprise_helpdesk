import { SupplyRequestsService } from './supply-requests.service';
import { SupplyRequestStatus } from './schemas/supply-request.schema';

/**
 * ທົດສອບການຜູກ POPR ກັບໃບຂໍຊື້: ຕ້ອງມີຈິງ / ອະນຸມັດແລ້ວ / index ຢູ່ໃນຊ່ວງ
 */
describe('SupplyRequestsService.assertLinkableForPopr', () => {
  const build = (request: any) => {
    const requestModel = {
      findById: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(request),
      }),
    };
    const service = new SupplyRequestsService(
      requestModel as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return { service, requestModel };
  };

  it('rejects an unknown supply request', async () => {
    const { service } = build(null);
    await expect(service.assertLinkableForPopr('SR999')).rejects.toThrow(
      /not found/i,
    );
  });

  it('rejects a request that has not been approved', async () => {
    const { service } = build({
      status: SupplyRequestStatus.REQUESTED,
      items: [{ name: 'A', quantity: 1 }],
    });
    await expect(service.assertLinkableForPopr('SR001')).rejects.toThrow(
      /REQUESTED/,
    );
  });

  it('rejects a rejected request', async () => {
    const { service } = build({
      status: SupplyRequestStatus.REJECTED,
      items: [{ name: 'A', quantity: 1 }],
    });
    await expect(service.assertLinkableForPopr('SR001')).rejects.toThrow(
      /REJECTED/,
    );
  });

  it('rejects an item index that is out of range', async () => {
    const { service } = build({
      status: SupplyRequestStatus.APPROVED,
      items: [{ name: 'A', quantity: 1 }],
    });
    await expect(service.assertLinkableForPopr('SR001', 3)).rejects.toThrow(
      /out of range/i,
    );
    await expect(service.assertLinkableForPopr('SR001', -1)).rejects.toThrow(
      /out of range/i,
    );
  });

  it('accepts an approved request with a valid item index', async () => {
    const request = {
      status: SupplyRequestStatus.APPROVED,
      items: [{ name: 'A', quantity: 1 }],
    };
    const { service } = build(request);
    await expect(service.assertLinkableForPopr('SR001', 0)).resolves.toBe(
      request,
    );
  });

  it('accepts an ordered request (POPR already exists)', async () => {
    const request = {
      status: SupplyRequestStatus.ORDERED,
      items: [{ name: 'A', quantity: 1 }],
    };
    const { service } = build(request);
    await expect(service.assertLinkableForPopr('SR001', 0)).resolves.toBe(
      request,
    );
  });
});
