import { adminPrivilegeSnapshotAllows } from './admin-privilege-watch.service';

describe('AdminPrivilegeWatchService / estado canônico', () => {
  const admin = { accountStatus: 'active', role: 'admin' };

  it('permite somente privilégio confirmado pelo servidor', () => {
    expect(adminPrivilegeSnapshotAllows(admin, false)).toBe(true);
    expect(adminPrivilegeSnapshotAllows(admin, true)).toBe(false);
  });

  it('nega revogação, exclusão e suspensão', () => {
    expect(adminPrivilegeSnapshotAllows({ role: 'free', accountStatus: 'active' }, false)).toBe(false);
    expect(adminPrivilegeSnapshotAllows(null, false)).toBe(false);
    expect(adminPrivilegeSnapshotAllows({ ...admin, suspended: true }, false)).toBe(false);
    expect(adminPrivilegeSnapshotAllows({ ...admin, accountLocked: true }, false)).toBe(false);
    expect(adminPrivilegeSnapshotAllows({ ...admin, loginAllowed: false }, false)).toBe(false);
  });
});
