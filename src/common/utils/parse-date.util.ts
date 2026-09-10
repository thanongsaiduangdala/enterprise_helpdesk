import { BadRequestException } from '@nestjs/common';

export function parseRequiredDate(value: string | undefined, paramName: string): Date {
    if (!value) {
        throw new BadRequestException(`"${paramName}" is required`);
    }
    const d = new Date(value);
    if (isNaN(d.getTime())) {
        throw new BadRequestException(`"${paramName}" is not a valid date: ${value}`);
    }
    return d;
}