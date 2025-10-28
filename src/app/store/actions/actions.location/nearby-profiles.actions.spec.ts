//src/app/store/actions/actions.location/nearby-profiles.actions.spec.ts
import { NearbyProfilesActions } from './nearby-profiles.actions';
import { NearbyQueryParams } from '../../states/states.location/nearby-profiles.state';
import { IUserDados } from '../../../core/interfaces/iuser-dados';


describe('NearbyProfilesActions (createActionGroup)', () => {
  const params: NearbyQueryParams = { uid: 'u1', lat: -10, lon: -20, radiusKm: 15 };

  it('should create load action (type + payload)', () => {
    const action = NearbyProfilesActions.load({ params, force: true });
    expect(action.type).toBe('[Nearby Profiles] load');
    expect(action.params).toEqual(params);
    expect(action.force).toBeTrue();
  });

  it('should create loaded action (type + payload)', () => {
    const list: IUserDados[] = [{ uid: 'a' } as IUserDados];
    const action = NearbyProfilesActions.loaded({ key: 'k1', list, updatedAt: 123 });
    expect(action.type).toBe('[Nearby Profiles] loaded');
    expect(action.key).toBe('k1');
    expect(action.list).toEqual(list);
    expect(action.updatedAt).toBe(123);
  });

  it('should create error action (type + payload)', () => {
    const action = NearbyProfilesActions.error({ key: 'k1', message: 'boom' });
    expect(action.type).toBe('[Nearby Profiles] error');
    expect(action.key).toBe('k1');
    expect(action.message).toBe('boom');
  });

  it('should create invalidate action (type + optional key)', () => {
    const a1 = NearbyProfilesActions.invalidate({ key: 'k1' });
    const a2 = NearbyProfilesActions.invalidate({}); // sem key => invalida todos
    expect(a1.type).toBe('[Nearby Profiles] invalidate');
    expect(a1.key).toBe('k1');
    expect(a2.type).toBe('[Nearby Profiles] invalidate');
    expect(a2).toEqual(jasmine.objectContaining({}));
  });
});
