import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { SupplyRequestsService } from './supply-requests.service';

describe('SupplyRequestsService.findCustodianCandidates', () => {
  let service: SupplyRequestsService;
  let usersService: { findOneRaw: jest.Mock; searchForPicker: jest.Mock };
  let departmentsService: {
    findRequestableForUser: jest.Mock;
    findOne: jest.Mock;
  };

  beforeEach(() => {
    usersService = {
      findOneRaw: jest.fn().mockResolvedValue({ departmentId: 'DX001' }),
      searchForPicker: jest
        .fn()
        .mockResolvedValue([{ _id: 'u1', employeeCode: 'EMP001' }]),
    };
    departmentsService = {
      findRequestableForUser: jest
        .fn()
        .mockResolvedValue([{ _id: 'DX001', name: 'IT Support', branchId: 'B1' }]),
      findOne: jest.fn().mockResolvedValue({ _id: 'DX001', managerIds: ['m1'] }),
    };
    service = new SupplyRequestsService(
      {} as any,
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

  it('searches only members/managers of the chosen department', async () => {
    const res = await service.findCustodianCandidates('DX001', 'som', 'user-1');

    expect(res).toEqual({ users: [{ _id: 'u1', employeeCode: 'EMP001' }] });
    expect(usersService.searchForPicker).toHaveBeenCalledWith({
      q: 'som',
      restrictToDepartmentId: 'DX001',
      alsoUserIds: ['m1'],
      limit: 30,
    });
  });

  it('rejects a department the caller cannot request for', async () => {
    await expect(
      service.findCustodianCandidates('DX999', undefined, 'user-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(usersService.searchForPicker).not.toHaveBeenCalled();
  });

  it('requires a departmentId', async () => {
    await expect(
      service.findCustodianCandidates('', undefined, 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
