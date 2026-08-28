import {
    ConflictException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Department, DepartmentDocument } from './schemas/department.schema';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { BranchesService } from '../branches/branches.service';
import { TicketTypesService } from '../ticket-types/ticket-types.service';

@Injectable()
export class DepartmentsService {
    constructor(
        @InjectModel(Department.name) private departmentModel: Model<DepartmentDocument>,
        private branchesService: BranchesService,
        private ticketTypesService: TicketTypesService,
    ) { }

    private async generateId(): Promise<string> {
        const last = await this.departmentModel
            .findOne({ _id: /^DX\d{3}$/ })
            .sort({ _id: -1 })
            .exec();
        const nextSeq = last ? parseInt(last._id.slice(2), 10) + 1 : 1;
        return `DX${String(nextSeq).padStart(3, '0')}`;
    }

    private async withTicketTypes(department: DepartmentDocument) {
        const allTypes = await this.ticketTypesService.findAll();
        const ticketTypes = allTypes.filter(
            (t) => t.defaultDepartmentId === department._id,
        );
        return { ...department.toObject(), ticketTypes };
    }

    async create(dto: CreateDepartmentDto) {
        await this.branchesService.findOne(dto.branchId); // throws 404 if branch doesn't exist

        const existing = await this.departmentModel.findOne({
            branchId: dto.branchId,
            name: dto.name,
        });
        if (existing) {
            throw new ConflictException(
                `Department "${dto.name}" already exists in this branch`,
            );
        }

        const _id = await this.generateId();
        const department = new this.departmentModel({ _id, ...dto });
        return department.save();
    }

    async findAll() {
        const departments = await this.departmentModel.find().exec();
        return Promise.all(departments.map((d) => this.withTicketTypes(d)));
    }

    async findOne(id: string) {
        const department = await this.departmentModel.findById(id).exec();
        if (!department) throw new NotFoundException('Department not found');
        return this.withTicketTypes(department);
    }

    async update(id: string, dto: UpdateDepartmentDto) {
        if (dto.branchId) {
            await this.branchesService.findOne(dto.branchId);
        }
        const department = await this.departmentModel
            .findByIdAndUpdate(id, dto, { new: true })
            .exec();
        if (!department) throw new NotFoundException('Department not found');
        return this.withTicketTypes(department);
    }

    async remove(id: string) {
        const result = await this.departmentModel.findByIdAndDelete(id).exec();
        if (!result) throw new NotFoundException('Department not found');
        return { deleted: true };
    }
}