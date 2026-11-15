export interface AdminUserOverview {
  totalUsers: number;
  completedProfiles: number;
  incompleteProfiles: number;
  restrictedUsers: number;
  onlineUsers: number;
  subscribers: number;
}

const allowedFields: readonly (keyof AdminUserOverview)[] = [
  'totalUsers',
  'completedProfiles',
  'incompleteProfiles',
  'restrictedUsers',
  'onlineUsers',
  'subscribers',
];

export function parseAdminUserOverview(
  response: unknown
): AdminUserOverview {
  if (
    response === null ||
    typeof response !== 'object' ||
    Array.isArray(response)
  ) {
    throw new Error('Invalid administrative overview.');
  }

  const source = response as Record<string, unknown>;
  const received = Object.keys(source).sort();
  const expected = [...allowedFields].sort();

  if (
    received.length !== expected.length ||
    received.some((field, index) => field !== expected[index])
  ) {
    throw new Error('Unexpected administrative fields.');
  }

  const result = {} as AdminUserOverview;

  for (const field of allowedFields) {
    const value = source[field];

    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value < 0
    ) {
      throw new Error('Invalid administrative count.');
    }

    result[field] = value;
  }

  if (
    result.completedProfiles + result.incompleteProfiles !==
    result.totalUsers
  ) {
    throw new Error('Inconsistent profile counts.');
  }

  for (const field of allowedFields) {
    if (
      field !== 'totalUsers' &&
      result[field] > result.totalUsers
    ) {
      throw new Error('Inconsistent administrative count.');
    }
  }

  return result;
}
