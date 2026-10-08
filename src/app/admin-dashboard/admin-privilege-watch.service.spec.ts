import { adminPrivilegeSnapshotAllows } from './admin-privilege-watch.service';

describe('AdminPrivilegeWatchService / estado canônico', () => {
  const admin = { accountStatus: 'active', role: 'admin' };

  it('permite somente privilégio confirmado pelo servidor', () => {
    expect(adminPrivilegeSnapshotAllows(admin, false)).toBeTrue();
    expect(adminPrivilegeSnapshotAllows(admin, true)).toBeFalse();
  });

  it('nega revogação, exclusão e suspensão', () => {
    expect(adminPrivilegeSnapshotAllows({ role: 'free', accountStatus: 'active' }, false)).toBeFalse();
    expect(adminPrivilegeSnapshotAllows(null, false)).toBeFalse();
    expect(adminPrivilegeSnapshotAllows({ ...admin, suspended: true }, false)).toBeFalse();
    expect(adminPrivilegeSnapshotAllows({ ...admin, accountLocked: true }, false)).toBeFalse();
    expect(adminPrivilegeSnapshotAllows({ ...admin, loginAllowed: false }, false)).toBeFalse();
  });
});
