import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { SessionsService } from '../sessions/sessions.service';
import { MfaAttemptsService } from '../mfa-attempts/mfa-attempts.service';
import { MailService } from '../mail/mail.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: { findByEmail: jest.fn() } },
        {
          provide: JwtService,
          useValue: { sign: jest.fn(), verify: jest.fn() },
        },
        {
          provide: SessionsService,
          useValue: { create: jest.fn(), isValid: jest.fn(), touch: jest.fn() },
        },
        {
          provide: MfaAttemptsService,
          useValue: {
            assertNotLockedOut: jest.fn(),
            createChallenge: jest.fn(),
            verify: jest.fn(),
            recordFailure: jest.fn(),
          },
        },
        {
          provide: MailService,
          useValue: { sendMail: jest.fn(), send: jest.fn() },
        },
        {
          provide: AuditLogsService,
          useValue: { log: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
