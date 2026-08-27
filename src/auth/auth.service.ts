import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';

@Injectable()
export class AuthService {
    constructor(
        private usersService: UsersService,
        private jwtService: JwtService,
    ) { }

    async login(email: string, password: string) {
        const user = await this.usersService.findByEmail(email);
        if (!user) throw new UnauthorizedException('Invalid credentials');

        // FIX: was comparing against `user.password`, a field that doesn't
        // exist on the User schema (it's `passwordHash`). This meant
        // bcrypt.compare(password, undefined) - which always resolves to
        // false, so no login could ever succeed. Fixed to compare against
        // the actual stored field.
        const passwordMatches = await bcrypt.compare(password, user.passwordHash);
        if (!passwordMatches) throw new UnauthorizedException('Invalid credentials');

        // ADDED: block login for deactivated accounts. The Users module
        // supports isActive/deactivatedAt, but nothing was checking it -
        // a deactivated employee could still log in and get a valid token.
        if (!user.isActive) {
            throw new UnauthorizedException('This account has been deactivated');
        }

        // FIX: `user.role` used to be a plain string enum value
        // ("DEPT_MANAGER"), so dropping it straight into the JWT payload
        // worked by accident. Now that `role` is a reference,
        // findByEmail() populates it, so `user.role` here is the full role
        // document - pull out just what guards/the frontend actually need
        // (name + permissions), not the whole Mongoose object.
        const role = user.role as any; // populated Role document
        const payload = {
            sub: user._id,
            email: user.email,
            role: role.name,
            permissions: role.permissions,
        };
        const token = this.jwtService.sign(payload);

        return { accessToken: token };
    }
}
