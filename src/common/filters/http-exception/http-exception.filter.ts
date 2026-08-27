import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus
} from "@nestjs/common";

import { Response } from 'express';
// FIX: removed `import { stat } from "fs"` - unused import left over from
// somewhere else, not related to this file at all.

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const exceptionResponse = exception.getResponse(); // FIX: typo "exceptionReponse" -> "exceptionResponse"

      if (typeof exceptionResponse == 'string') {
        message = exceptionResponse;
      } else if (
        typeof exceptionResponse === 'object' && 'message' in exceptionResponse
      ) {
        const msg = (exceptionResponse as any).message;
        message = Array.isArray(msg) ? msg.join(', ') : msg;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    response.status(statusCode).json({
      response: statusCode,
      msg: message,
      data: null,
      time: new Date().toISOString(),
    });
  }
}
