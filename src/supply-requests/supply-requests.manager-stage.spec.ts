import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SupplyRequestsService } from './supply-requests.service';
import {
  SupplyRequestSource,
  SupplyRequestStatus,
} from './schemas/supply-request.schema';
import { PermissionUser } from '../common/utils/permission.util';

/** ຂັ້ນທີ 1: ຄຳຂໍສ່ວນບຸກຄົນຕ້ອງຜ່ານຫົວໜ້າພະແນກກ່ອນເຂົ້າຄິວຝ່າຍສາງ */
describe('SupplyRequestsService manager stage', () => {
  let service: SupplyRequestsService;
  let saved: any;
  let requestModel: any;
  let usersService: any;
  let departmentsService: any;
  let notifications: any;
  let audit: any;
  let assetsService: any;
  let purchaseModel: any;
  let stored: Map<string, any>;

  const employee: PermissionUser = {
    userId: 'emp-1',
    permissions: [{ module: 'supplies', actions: ['read', 'create'] }],
  };
  const head: PermissionUser = {
    userId: 'head-1',
    permissions: [{ module: 'supplies', actions: ['read', 'create'] }],
  };
  const approver: PermissionUser = {
    userId: 'appr-1',
    permissions: [{ module: 'supplies', actions: ['read', 'approve'] }],
  };

  const dto: any = {
    items: [{ name: 'Pen', quantity: 2, catalogItemId: 'SC001' }],
  };

  const pending = (over: Record<string, any> = {}) => {
    const r: any = {
      _id: 'SR001',
      requestedBy: 'emp-1',
      status: SupplyRequestStatus.PENDING_MANAGER,
      managerDepartmentId: 'DX001',
      items: [],
      save: jest.fn(function (this: any) {
        return Promise.resolve(this);
      }),
      toObject: jest.fn(function (this: any) {
        return { ...this };
      }),
      ...over,
    };
    stored.set(r._id, r);
    return r;
  };

  beforeEach(() => {
    stored = new Map();
    saved = undefined;
    const ctor: any = jest.fn().mockImplementation((doc: any) => {
      saved = {
        ...doc,
        save: jest.fn(function (this: any) {
          return Promise.resolve(this);
        }),
        toObject: jest.fn(function (this: any) {
          return { ...this };
        }),
        items: doc.items,
      };
      return saved;
    });
    ctor.find = jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      populate: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    });
    ctor.findById = jest.fn((id: string) => ({
      exec: jest.fn().mockResolvedValue(stored.get(id) ?? null),
    }));
    requestModel = ctor;
    usersService = {
      findOneRaw: jest.fn((id: string) =>
        Promise.resolve({
          _id: id,
          isActive: true,
          firstName: id,
          departmentId: id === 'emp-1' ? 'DX001' : undefined,
        }),
      ),
      findActiveIdsWithPermission: jest.fn().mockResolvedValue(['appr-1']),
    };
    departmentsService = {
      findOne: jest
        .fn()
        .mockResolvedValue({ _id: 'DX001', name: 'IT', managerIds: ['head-1'] }),
      findManagedDepartmentIds: jest.fn((id: string) =>
        Promise.resolve(id === 'head-1' ? ['DX001'] : []),
      ),
    };
    notifications = { notify: jest.fn().mockResolvedValue(undefined) };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    assetsService = { releaseReservationsForRequest: jest.fn() };
    purchaseModel = {
      find: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
      updateMany: jest.fn().mockReturnValue({ exec: jest.fn() }),
    };
    const catalogService = {
      findOne: jest.fn().mockResolvedValue({ _id: 'SC001' }),
      findByName: jest.fn(),
    };
    service = new SupplyRequestsService(
      requestModel,
      catalogService as any,
      audit,
      usersService,
      departmentsService,
      assetsService,
      {} as any,
      notifications,
      purchaseModel,
    );
  });

  describe('create (personal)', () => {
    it('goes to PENDING_MANAGER and notifies only the department head', async () => {
      await service.create(dto, 'emp-1');
      expect(saved.status).toBe(SupplyRequestStatus.PENDING_MANAGER);
      expect(saved.source).toBe(SupplyRequestSource.PERSONAL);
      expect(saved.managerDepartmentId).toBe('DX001');
      expect(notifications.notify).toHaveBeenCalledTimes(1);
      expect(notifications.notify.mock.calls[0][0]).toBe('head-1');
      expect(notifications.notify.mock.calls[0][1]).toBe(
        'SUPPLY_REQUEST_MANAGER_REVIEW',
      );
    });

    it('skips the manager stage when the requester is the department head', async () => {
      usersService.findOneRaw.mockImplementation((id: string) =>
        Promise.resolve({ _id: id, isActive: true, departmentId: 'DX001' }),
      );
      await service.create(dto, 'head-1');
      expect(saved.status).toBe(SupplyRequestStatus.REQUESTED);
      expect(saved.managerStageSkipped).toBe('REQUESTER_IS_MANAGER');
      expect(notifications.notify).toHaveBeenCalledWith(
        'appr-1',
        'SUPPLY_REQUEST_AWAITING_APPROVAL',
        expect.any(String),
        'SupplyRequest',
        expect.any(String),
        expect.any(String),
      );
    });

    it('skips when the department has no active manager', async () => {
      departmentsService.findOne.mockResolvedValue({
        _id: 'DX001',
        name: 'IT',
        managerIds: [],
      });
      await service.create(dto, 'emp-1');
      expect(saved.status).toBe(SupplyRequestStatus.REQUESTED);
      expect(saved.managerStageSkipped).toBe('NO_MANAGER');
    });

    it('skips when the requester has no department', async () => {
      usersService.findOneRaw.mockResolvedValue({ _id: 'emp-1', isActive: true });
      await service.create(dto, 'emp-1');
      expect(saved.status).toBe(SupplyRequestStatus.REQUESTED);
      expect(saved.managerStageSkipped).toBe('NO_DEPARTMENT');
    });

    it('department requests go straight to the warehouse queue (no manager stage)', async () => {
      usersService.findOneRaw.mockImplementation((id: string) =>
        Promise.resolve({
          _id: id,
          isActive: true,
          departmentId: 'DX001',
          firstName: id,
        }),
      );
      await service.create(
        { ...dto, departmentId: 'DX001', custodianId: 'emp-1' },
        'emp-1',
      );
      expect(saved.status).toBeUndefined();
      expect(saved.source).toBe(SupplyRequestSource.DEPARTMENT);
      expect(saved.managerDepartmentId).toBeUndefined();
    });
  });

  describe('manager review', () => {
    it('head approval moves the request to REQUESTED and notifies requester + approvers', async () => {
      const r = pending();
      const out = await service.managerApprove('SR001', head);
      expect(out.status).toBe(SupplyRequestStatus.REQUESTED);
      expect(r.managerApprovedBy).toBe('head-1');
      expect(r.managerApprovedAsSubstitute).toBe(false);
      expect(audit.log.mock.calls[0][1]).toBe('SUPPLY_REQUEST_MANAGER_APPROVED');
      const types = notifications.notify.mock.calls.map((c: any[]) => c[1]);
      expect(types).toEqual(
        expect.arrayContaining([
          'SUPPLY_REQUEST_MANAGER_APPROVED',
          'SUPPLY_REQUEST_AWAITING_APPROVAL',
        ]),
      );
    });

    it('a user who is not the head (and has no approve permission) is forbidden', async () => {
      pending();
      await expect(
        service.managerApprove('SR001', { ...employee, userId: 'other-1' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('a head of another department is forbidden', async () => {
      pending({ managerDepartmentId: 'DX999' });
      await expect(service.managerApprove('SR001', head)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('a supplies:approve user can approve on behalf and it is audited as substitute', async () => {
      const r = pending();
      await service.managerApprove('SR001', approver);
      expect(r.managerApprovedAsSubstitute).toBe(true);
      expect(audit.log.mock.calls[0][1]).toBe(
        'SUPPLY_REQUEST_MANAGER_APPROVED_AS_SUBSTITUTE',
      );
    });

    it('the requester cannot approve their own request (SoD)', async () => {
      pending({ requestedBy: 'appr-1' });
      await expect(service.managerApprove('SR001', approver)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('rejection stores the reason, releases links and notifies the requester', async () => {
      const r = pending();
      await service.managerReject('SR001', head, 'ບໍ່ຈຳເປັນ');
      expect(r.status).toBe(SupplyRequestStatus.REJECTED);
      expect(r.rejectionReason).toBe('ບໍ່ຈຳເປັນ');
      expect(r.managerRejectedBy).toBe('head-1');
      expect(assetsService.releaseReservationsForRequest).toHaveBeenCalledWith('SR001');
      expect(notifications.notify.mock.calls[0][1]).toBe('SUPPLY_REQUEST_MANAGER_REJECTED');
    });

    it('cannot review a request that is not pending the manager', async () => {
      pending({ status: SupplyRequestStatus.REQUESTED });
      await expect(service.managerApprove('SR001', head)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('warehouse approval is blocked while the manager has not approved', async () => {
      pending();
      await expect(service.approve('SR001', 'appr-1')).rejects.toThrow(
        /ຫົວໜ້າພະແນກ/,
      );
    });
  });

  describe('manager queue', () => {
    it('head sees only their departments; others get 403; approvers see all', async () => {
      await service.findManagerQueue(head);
      expect(requestModel.find).toHaveBeenLastCalledWith({
        status: SupplyRequestStatus.PENDING_MANAGER,
        managerDepartmentId: { $in: ['DX001'] },
      });
      await service.findManagerQueue(approver);
      expect(requestModel.find).toHaveBeenLastCalledWith({
        status: SupplyRequestStatus.PENDING_MANAGER,
      });
      await expect(
        service.findManagerQueue({ ...employee, userId: 'x' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });
});
