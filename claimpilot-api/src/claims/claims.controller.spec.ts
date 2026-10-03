import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { EnvConfig } from '../config/env.validation';
import type { TraceService } from '../trace/trace.service';
import { ClaimsController } from './claims.controller';
import type { ClaimsService } from './claims.service';

const body = { customerId: 'C-1042', policyId: 'P-77', message: 'Delayed' };

/**
 * Builds the controller with failure injection on or off.
 * @param allowInjection ALLOW_FAILURE_INJECTION value.
 */
function setup(allowInjection: boolean) {
    const claims = { create: jest.fn().mockResolvedValue({}) };
    const controller = new ClaimsController(
        claims as unknown as ClaimsService,
        {} as TraceService,
        { get: () => allowInjection } as unknown as ConfigService<EnvConfig, true>,
    );
    return { controller, claims };
}

describe('ClaimsController failure injection', () => {
    it('ignores a missing header', async () => {
        const { controller, claims } = setup(false);
        await controller.create(body);
        expect(claims.create).toHaveBeenCalledWith(body, []);
    });

    it('refuses the header when injection is disabled', () => {
        const { controller } = setup(false);
        expect(() => controller.create(body, 'weather')).toThrow(BadRequestException);
    });

    it('passes the named steps through when enabled', async () => {
        const { controller, claims } = setup(true);
        await controller.create(body, ' policy, weather ');
        expect(claims.create).toHaveBeenCalledWith(body, ['policy', 'weather']);
    });
});
