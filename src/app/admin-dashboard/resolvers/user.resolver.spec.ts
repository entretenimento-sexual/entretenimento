import {
  ActivatedRouteSnapshot,
  Router,
  convertToParamMap,
} from '@angular/router';
import { firstValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { UserResolver } from './user.resolver';
import { AdminUserDetailService } from '../../core/services/account-moderation/admin-user-detail.service';

const row = {
  uid: 'synthetic_1',
  nickname: 'nickname',
  profileCompleted: true,
  accountStatus: 'active' as const,
  suspended: false,
  accountLocked: false,
  interactionBlocked: false,
  loginAllowed: true,
};

const route = {
  paramMap: convertToParamMap({ uid: 'synthetic_1' }),
} as ActivatedRouteSnapshot;

describe('Safe administrative user resolver', () => {
  it('loads details from the safe callable service', async () => {
    const load = vi.fn(() => of(row));
    const navigate = vi.fn();

    const resolver = new UserResolver(
      { getAdminUserDetail$: load } as unknown as AdminUserDetailService,
      { navigate } as unknown as Router
    );

    expect(await firstValueFrom(resolver.resolve(route))).toEqual(row);
    expect(load).toHaveBeenCalledWith('synthetic_1');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('redirects when the record does not exist', async () => {
    const navigate = vi.fn();
    const resolver = new UserResolver(
      {
        getAdminUserDetail$: vi.fn(() => of(null)),
      } as unknown as AdminUserDetailService,
      { navigate } as unknown as Router
    );

    expect(
      await firstValueFrom(resolver.resolve(route), {
        defaultValue: null,
      })
    ).toBeNull();

    expect(navigate).toHaveBeenCalled();
  });

  it('redirects when the secure request fails', async () => {
    const navigate = vi.fn();
    const resolver = new UserResolver(
      {
        getAdminUserDetail$: vi.fn(() =>
          throwError(() => new Error('permission-denied'))
        ),
      } as unknown as AdminUserDetailService,
      { navigate } as unknown as Router
    );

    expect(
      await firstValueFrom(resolver.resolve(route), {
        defaultValue: null,
      })
    ).toBeNull();

    expect(navigate).toHaveBeenCalled();
  });
});
