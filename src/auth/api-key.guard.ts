import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const key = req.headers['x-api-key'];
    if (!key || key !== process.env.PROVISIONER_API_KEY) throw new UnauthorizedException();
    return true;
  }
}
