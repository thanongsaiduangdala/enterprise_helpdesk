import { getEnabledMethods, verifiersFor } from './mfa-methods.util';

describe('mfa-methods.util', () => {
    describe('getEnabledMethods', () => {
        it('returns [] when MFA is not set up', () => {
            expect(getEnabledMethods(undefined)).toEqual([]);
            expect(getEnabledMethods({ enabled: false })).toEqual([]);
        });

        it('reads the new methods array', () => {
            expect(getEnabledMethods({ enabled: true, methods: ['totp', 'email'] })).toEqual(['email', 'totp']);
        });

        it('falls back to the legacy single method', () => {
            expect(getEnabledMethods({ enabled: true, method: 'pin' })).toEqual(['pin']);
        });
    });

    describe('verifiersFor', () => {
        it('needs no proof when nothing is enabled yet', () => {
            expect(verifiersFor([], 'pin')).toEqual([]);
        });

        it('changing the PIN needs email or auth app', () => {
            expect(verifiersFor(['email', 'pin', 'totp'], 'pin')).toEqual(['email', 'totp']);
        });

        it('changing email needs PIN or auth app', () => {
            expect(verifiersFor(['email', 'pin', 'totp'], 'email')).toEqual(['pin', 'totp']);
        });

        it('changing the auth app needs PIN or email', () => {
            expect(verifiersFor(['email', 'pin', 'totp'], 'totp')).toEqual(['email', 'pin']);
        });

        it('adding a method is verified with any enabled method', () => {
            expect(verifiersFor(['pin'], 'totp')).toEqual(['pin']);
        });

        it('falls back to the method itself when it is the only one enabled', () => {
            expect(verifiersFor(['pin'], 'pin')).toEqual(['pin']);
        });
    });
});
