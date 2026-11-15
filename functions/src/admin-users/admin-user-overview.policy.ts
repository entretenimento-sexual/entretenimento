export interface AdminUserOverviewCounts {
  totalUsers: number;
  completedProfiles: number;
  restrictedUsers: number;
  onlineUsers: number;
  subscribers: number;
}

export interface AdminUserOverview
  extends AdminUserOverviewCounts {
  incompleteProfiles: number;
}

function assertCount(
  value: number,
  maximum?: number
): void {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    (maximum !== undefined && value > maximum)
  ) {
    throw new Error('Invalid administrative aggregate.');
  }
}

export function buildAdminUserOverview(
  counts: AdminUserOverviewCounts
): AdminUserOverview {
  const total = counts.totalUsers;

  assertCount(total);
  assertCount(counts.completedProfiles, total);
  assertCount(counts.restrictedUsers, total);
  assertCount(counts.onlineUsers, total);
  assertCount(counts.subscribers, total);

  return {
    totalUsers: total,
    completedProfiles: counts.completedProfiles,
    incompleteProfiles:
      total - counts.completedProfiles,
    restrictedUsers: counts.restrictedUsers,
    onlineUsers: counts.onlineUsers,
    subscribers: counts.subscribers,
  };
}
