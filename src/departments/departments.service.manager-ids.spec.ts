import { DepartmentsService } from './departments.service';

describe('DepartmentsService supply-request department access', () => {
  it('returns string IDs for departments listing the user as manager', async () => {
    const exec = jest.fn().mockResolvedValue([{ _id: 'DEPT-01' }, { _id: 7 }]);
    const lean = jest.fn().mockReturnValue({ exec });
    const find = jest.fn().mockReturnValue({ lean });
    const departmentModel = { find };
    const service = new DepartmentsService(
      departmentModel as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(
      service.findManagedDepartmentIds('manager-1'),
    ).resolves.toEqual(['DEPT-01', '7']);
    expect(find).toHaveBeenCalledWith(
      { managerIds: 'manager-1' },
      { _id: 1 },
    );
    expect(lean).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('returns only active requestable department picker fields', async () => {
    const exec = jest.fn().mockResolvedValue([
      {
        _id: 'DEPT-01',
        name: 'Operations',
        branchId: 'BR-01',
        managerIds: ['u1'],
      },
    ]);
    const lean = jest.fn().mockReturnValue({ exec });
    const find = jest.fn().mockReturnValue({ lean });
    const service = new DepartmentsService(
      { find } as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(
      service.findRequestableForUser('u1', 'DEPT-02'),
    ).resolves.toEqual([
      { _id: 'DEPT-01', name: 'Operations', branchId: 'BR-01' },
    ]);
    expect(find).toHaveBeenCalledWith(
      {
        isActive: { $ne: false },
        $or: [{ managerIds: 'u1' }, { _id: 'DEPT-02' }],
      },
      { _id: 1, name: 1, branchId: 1 },
    );
  });

});
