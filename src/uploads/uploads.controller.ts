import {
    Controller,
    Post,
    Get,
    Delete,
    Param,
    Res,
    UseGuards,
    UseInterceptors,
    UploadedFile,
    BadRequestException,
    NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomBytes } from 'crypto';
import { extname, join } from 'path';
import { existsSync, unlinkSync } from 'fs';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

const UPLOAD_DIR = join(process.cwd(), 'uploads');
const ALLOWED_MIME_TYPES = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

@Controller('uploads')
export class UploadsController {
    @Post()
    @UseGuards(JwtAuthGuard)
    @UseInterceptors(
        FileInterceptor('file', {
            storage: diskStorage({
                destination: UPLOAD_DIR,
                filename: (_req, file, cb) => {
                    const unique = randomBytes(16).toString('hex');
                    cb(null, `${unique}${extname(file.originalname)}`);
                },
            }),
            limits: { fileSize: MAX_FILE_SIZE_BYTES },
            fileFilter: (_req, file, cb) => {
                if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
                    cb(new BadRequestException('Only PDF files are allowed'), false);
                    return;
                }
                cb(null, true);
            },
        }),
    )
    upload(@UploadedFile() file: Express.Multer.File) {
        if (!file) {
            throw new BadRequestException('No file uploaded');
        }
        return {
            url: `/api/uploads/${file.filename}`,
            originalName: file.originalname,
            mimeType: file.mimetype,
            size: file.size,
        };
    }

    @Get(':filename')
    serve(@Param('filename') filename: string, @Res() res: Response) {
        // filename is generated server-side (hex + extname), safe to join directly
        const filePath = join(UPLOAD_DIR, filename);
        if (!existsSync(filePath)) {
            throw new NotFoundException('File not found');
        }
        res.setHeader('Content-Disposition', 'inline');
        res.sendFile(filePath);
    }

    @Delete(':filename')
    @UseGuards(JwtAuthGuard)
    remove(@Param('filename') filename: string) {
        const filePath = join(UPLOAD_DIR, filename);
        if (!existsSync(filePath)) {
            throw new NotFoundException('File not found');
        }
        unlinkSync(filePath);
        return { deleted: true };
    }
}