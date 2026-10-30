import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SupplyRequestsService } from './supply-requests.service';
import { SupplyRequestStatus } from './schemas/supply-request.schema';

jest.mock('../common/utils/sod.util', () => ({
  sodEnforced: jest.fn().mockResolvedValue(false),
}));

const REQUESTER = 'req-1';
const DELEGATE = 'del-1';
const STRANGER = 'str-1';
const STAFF = 'staff-1';

function makeRequest(overrides: Record<string, unknown> = {}) {
  const doc: any = {
    _id: 'SR001',
    requestedBy: REQUESTER,
    status: SupplyRequestStatus.APPROVED,
    items: [{ name: 'Pen', quantity: 2, catalogItemId: 'SC001' }],
    receivedAssetIds: [],
    ...overrides,
  };
  doc.toObject = () => ({ ...doc });
  doc.save = jest.fn().mockImplementation(async () => doc);
  return doc;
}

function setup(request: any) {
  const chain: any = {
    session: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(request),
  };
  const requestModel = { findById: jest.fn().mockReturnValue(chain) };
  const usersService = {
    findByEmployeeCode: jest.fn().mockResolvedValue({
      _id: DELEGATE,
      isActive: true,
      departmentId: 'DX001',
    }),
    searchForPicker: jest.fn().mockResolvedValue([]),
    findOneRaw: jest.fn().mockResolvedValue({
      firstName: 'Sam',
      lastName: 'Store',
      employeeCode: 'EMP900',
    }),
  };
  const departmentsService = {
    findManagedDepartmentIds: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(),
    findAll: jest.fn().mockResolvedValue([
      { _id: 'DX001', name: 'IT Support', isActive: true },
      { _id: 'DX002', name: 'Closed Dept', isActive: false },
    ]),
  };
  const assetsService = {
    requiresAssetTagForCatalog: jest.fn().mockResolvedValue(false),
    findManyByIds: jest.fn().mockResolvedValue([]),
    findByTagOrId: jest.fn(),
    assignInCtx: jest.fn(),
    flushAudits: jest.fn().mockResolvedValue(undefined),
    reserveForRequestInTx: jest.fn().mockResolvedValue(undefined),
    releaseReservationsForRequest: jest.fn().mockResolvedValue(undefined),
  };
  const catalogService = {
    findOne: jest.fn().mockResolvedValue({ stockQty: 100 }),
    adjustStock: jest.fn().mockResolvedValue(undefined),
  };
  const auditLogsService = { log: jest.fn().mockResolvedValue(undefined) };
  const notificationsService = { notify: jest.fn().mockResolvedValue({}) };
  const connection = {
    startSession: async () => ({
      withTransaction: async (fn: () => Promise<void>) => fn(),
      endSession: async () => undefined,
    }),
  };
  const service = new SupplyRequestsService(
    requestModel as any,
    catalogService as any,
    auditLogsService as any,
    usersService as any,
    departmentsService as any,
    assetsService as any,
    connection as any,
    notificationsService as any,
    {} as any,
  );
  return {
    service,
    usersService,
    assetsService,
    auditLogsService,
    notificationsService,
  };
}

const asUser = (userId: string, ...perms: Array<[string, string]>) => ({
  userId,
  role: 'USER',
  permissions: perms.map(([module, action]) => ({ module, actions: [action] })),
});

describe('SupplyRequestsService.setDelegate', () => {
  it('lets the requester name one delegate, audits it and notifies them', async () => {
    const request = makeRequest();
    const { service, auditLogsService, notificationsService } = setup(request);

    await service.setDelegate(
      'SR001',
      { delegateCode: 'EMP002' },
      asUser(REQUESTER),
    );

    expect(String(request.delegateId)).toBe(DELEGATE);
    expect(String(request.delegateSetBy)).toBe(REQUESTER);
    expect(auditLogsService.log).toHaveBeenCalledWith(
      REQUESTER,
      'SUPPLY_REQUEST_DELEGATE_SET',
      'SupplyRequest',
      'SR001',
      expect.anything(),
      expect.anything(),
      undefined,
    );
    expect(notificationsService.notify).toHaveBeenCalledWith(
      DELEGATE,
      'SUPPLY_REQUEST_DELEGATE_SET',
      'SR001',
      'SupplyRequest',
      expect.any(String),
      expect.any(String),
    );
  });

  it('rejects someone who is not the requester, custodian or department manager', async () => {
    const { service } = setup(makeRequest());
    await expect(
      service.setDelegate('SR001', { delegateCode: 'EMP002' }, asUser(STRANGER)),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not let storeroom staff name a delegate (they use the override)', async () => {
    const { service } = setup(makeRequest());
    await expect(
      service.setDelegate(
        'SR001',
        { delegateCode: 'EMP002' },
        asUser(STAFF, ['supplies', 'fulfill'], ['assets', 'assign']),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects naming the requester as their own delegate', async () => {
    const { service, usersService } = setup(makeRequest());
    usersService.findByEmployeeCode.mockResolvedValue({
      _id: REQUESTER,
      isActive: true,
    });
    await expect(
      service.setDelegate('SR001', { delegateCode: 'EMP001' }, asUser(REQUESTER)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('is only allowed after approval', async () => {
    const { service } = setup(
      makeRequest({ status: SupplyRequestStatus.REQUESTED }),
    );
    await expect(
      service.setDelegate('SR001', { delegateCode: 'EMP002' }, asUser(REQUESTER)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('clears the delegate with null', async () => {
    const request = makeRequest({ delegateId: DELEGATE });
    const { service, auditLogsService } = setup(request);

    await service.setDelegate('SR001', { delegateCode: null }, asUser(REQUESTER));

    expect(request.delegateId).toBeUndefined();
    expect(auditLogsService.log).toHaveBeenCalledWith(
      REQUESTER,
      'SUPPLY_REQUEST_DELEGATE_CLEARED',
      'SupplyRequest',
      'SR001',
      expect.anything(),
      expect.anything(),
      undefined,
    );
  });
});

describe('SupplyRequestsService.findDelegateCandidates', () => {
  it('searches active people, never including the requester, with the search and department filter', async () => {
    const { service, usersService } = setup(makeRequest());
    usersService.searchForPicker.mockResolvedValue([{ _id: DELEGATE }]);

    const result = await service.findDelegateCandidates(
      'SR001',
      { q: 'som', departmentId: 'DX001' },
      asUser(REQUESTER),
    );

    expect(usersService.searchForPicker).toHaveBeenCalledWith(
      expect.objectContaining({
        q: 'som',
        departmentId: 'DX001',
        excludeUserIds: [REQUESTER],
        restrictToDepartmentId: undefined,
      }),
    );
    expect(result.users).toEqual([{ _id: DELEGATE }]);
    expect(result.departments).toEqual([{ _id: 'DX001', name: 'IT Support' }]);
  });

  it('restricts a department request to that department and its managers', async () => {
    const { service, usersService } = setup(
      makeRequest({ departmentId: 'DX001', custodianId: 'cust-1' }),
    );
    (service as any).departmentsService.findOne.mockResolvedValue({
      name: 'IT Support',
      managerIds: ['mgr-1'],
    });

    const result = await service.findDelegateCandidates(
      'SR001',
      {},
      asUser('cust-1'),
    );

    expect(usersService.searchForPicker).toHaveBeenCalledWith(
      expect.objectContaining({
        restrictToDepartmentId: 'DX001',
        alsoUserIds: ['mgr-1'],
      }),
    );
    expect(result.departments).toEqual([{ _id: 'DX001', name: 'IT Support' }]);
  });

  it('refuses people who cannot name a delegate', async () => {
    const { service, usersService } = setup(makeRequest());
    await expect(
      service.findDelegateCandidates('SR001', {}, asUser(STRANGER)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(usersService.searchForPicker).not.toHaveBeenCalled();
  });
});

describe('SupplyRequestsService.receive — who may collect', () => {
  const dto = { confirmConsumables: true };
  const overrideEvents = (assetsService: any) =>
    (assetsService.flushAudits.mock.calls[0][0] as any[]).filter(
      (e) => e.action === 'SUPPLY_REQUEST_RECEIVE_OVERRIDE',
    );

  it('lets the requester collect with no override', async () => {
    const request = makeRequest();
    const { service, assetsService, notificationsService } = setup(request);
    await service.receive('SR001', dto, asUser(REQUESTER));
    expect(request.status).toBe(SupplyRequestStatus.CLOSED);
    expect(request.receiveOverride).toBeUndefined();
    expect(overrideEvents(assetsService)).toHaveLength(0);
    expect(notificationsService.notify).not.toHaveBeenCalled();
  });

  it('lets the named delegate collect with no override', async () => {
    const request = makeRequest({ delegateId: DELEGATE });
    const { service, assetsService, notificationsService } = setup(request);
    await service.receive('SR001', dto, asUser(DELEGATE));
    expect(request.status).toBe(SupplyRequestStatus.CLOSED);
    expect(String(request.fulfilledBy)).toBe(DELEGATE);
    expect(request.receiveOverride).toBeUndefined();
    expect(overrideEvents(assetsService)).toHaveLength(0);
    expect(notificationsService.notify).not.toHaveBeenCalled();
  });

  it('blocks a stranger who has no supplies.fulfill', async () => {
    const request = makeRequest({ delegateId: DELEGATE });
    const { service } = setup(request);
    await expect(
      service.receive('SR001', dto, asUser(STRANGER, ['supplies', 'read'])),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(request.status).toBe(SupplyRequestStatus.APPROVED);
  });

  it('blocks storeroom staff who lack assets.assign — the override needs it', async () => {
    const request = makeRequest();
    const { service } = setup(request);
    await expect(
      service.receive(
        'SR001',
        { ...dto, overrideReason: 'Requester is on leave' },
        asUser(STAFF, ['supplies', 'fulfill']),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(request.status).toBe(SupplyRequestStatus.APPROVED);
  });

  it('requires a written reason for the override', async () => {
    const request = makeRequest();
    const { service } = setup(request);
    await expect(
      service.receive(
        'SR001',
        dto,
        asUser(STAFF, ['supplies', 'fulfill'], ['assets', 'assign']),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(request.status).toBe(SupplyRequestStatus.APPROVED);
  });

  it('records the override, audits it and notifies the requester and the skipped delegate', async () => {
    const request = makeRequest({ delegateId: DELEGATE });
    const { service, assetsService, notificationsService } = setup(request);

    await service.receive(
      'SR001',
      { ...dto, overrideReason: '  Requester on leave, needed today  ' },
      asUser(STAFF, ['supplies', 'fulfill'], ['assets', 'assign']),
    );

    expect(request.status).toBe(SupplyRequestStatus.CLOSED);
    expect(request.receiveOverride).toMatchObject({
      by: STAFF,
      reason: 'Requester on leave, needed today',
    });
    const events = overrideEvents(assetsService);
    expect(events).toHaveLength(1);
    expect(events[0].after).toMatchObject({
      reason: 'Requester on leave, needed today',
      requesterId: REQUESTER,
      delegateId: DELEGATE,
    });
    const notified = notificationsService.notify.mock.calls.map((c) => c[0]);
    expect(notified.sort()).toEqual([DELEGATE, REQUESTER].sort());
  });
});
