import { SupplyRequestsService } from './supply-requests.service';

describe('SupplyRequestsService.findMine department-manager visibility', () => {
  let service: SupplyRequestsService;
  let requestModel: { find: jest.Mock };
  let usersService: { findOneRaw: jest.Mock };
  let departmentsService: {
    findManagedDepartmentIds: jest.Mock;
    findRequestableForUser: jest.Mock;
  };
  let query: {
    sort: jest.Mock;
    populate: jest.Mock;
    exec: jest.Mock;
  };

  beforeEach(() => {
    query = {
      sort: jest.fn().mockReturnThis(),
      populate: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };
    requestModel = { find: jest.fn().mockReturnValue(query) };
    usersService = {
      findOneRaw: jest.fn().mockResolvedValue({ departmentId: 'DEPT-OWN' }),
    };
    departmentsService = {
      findManagedDepartmentIds: jest.fn().mockResolvedValue([]),
      findRequestableForUser: jest.fn().mockResolvedValue([
        { _id: 'DEPT-OWN', name: 'Operations', branchId: 'BR-01' },
        { _id: 'DEPT-MANAGED', name: 'Finance', branchId: 'BR-02' },
      ]),
    };

    service = new SupplyRequestsService(
      requestModel as any,
      {} as any,
      {} as any,
      usersService as any,
      departmentsService as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  it('returns requestable departments using the profile department and manager memberships', async () => {
    const expected = [
      { _id: 'DEPT-OWN', name: 'Operations', branchId: 'BR-01' },
      { _id: 'DEPT-MANAGED', name: 'Finance', branchId: 'BR-02' },
    ];

    await expect(
      service.findRequestableDepartments('user-1'),
    ).resolves.toEqual(expected);
    expect(usersService.findOneRaw).toHaveBeenCalledWith('user-1');
    expect(departmentsService.findRequestableForUser).toHaveBeenCalledWith(
      'user-1',
      'DEPT-OWN',
    );
  });

  it('includes requests from departments where the user is a registered manager', async () => {
    departmentsService.findManagedDepartmentIds.mockResolvedValue([
      'DEPT-01',
      'DEPT-02',
    ]);

    await service.findMine('manager-1');

    expect(requestModel.find).toHaveBeenCalledWith({
      $or: [
        { requestedBy: 'manager-1' },
        { custodianId: 'manager-1' },
        { delegateId: 'manager-1' },
        { departmentId: { $in: ['DEPT-01', 'DEPT-02'] } },
      ],
    });
    expect(query.populate).toHaveBeenCalledWith('departmentId', 'name');
  });

  it('does not broaden a non-manager to all requests in their department', async () => {
    departmentsService.findManagedDepartmentIds.mockResolvedValue([]);

    await service.findMine('employee-1');

    expect(requestModel.find).toHaveBeenCalledWith({
      $or: [
        { requestedBy: 'employee-1' },
        { custodianId: 'employee-1' },
        { delegateId: 'employee-1' },
      ],
    });
  });
});
