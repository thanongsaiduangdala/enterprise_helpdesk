import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor
} from "@nestjs/common";
// FIX: removed `import { response } from "express"` - unused, and
// shadowed by the locally destructured `response` variable below anyway.
import { Observable } from "rxjs";
import { map } from "rxjs/operators";

export interface StandardResponse<T> {
  response: number;
  msg: string;
  data: T;
  time: string;
}

@Injectable()
export class ResponseInterceptor<T>
  implements NestInterceptor<T, StandardResponse<T>> {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<StandardResponse<T>> {
    return next.handle().pipe(
      map((data) => {
        const httpContext = context.switchToHttp();
        const response = httpContext.getResponse();
        const statusCode = response.statusCode;

        return {
          response: statusCode,
          msg: 'Success',
          data,
          time: new Date().toISOString(),
        };
      }),
    );
  }
}
