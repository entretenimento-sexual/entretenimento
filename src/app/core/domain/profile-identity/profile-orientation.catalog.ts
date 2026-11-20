export const PROFILE_ORIENTATION_OPTIONS = [
  { code: 'assexual', label: 'Assexual', shortLabel: 'Assexual' },
  { code: 'bissexual', label: 'Bissexual', shortLabel: 'Bi' },
  { code: 'heterossexual', label: 'Heterossexual', shortLabel: 'Hétero' },
  { code: 'homossexual', label: 'Homossexual', shortLabel: 'Homo' },
  { code: 'pansexual', label: 'Pansexual', shortLabel: 'Pan' },
] as const;

export function resolveProfileOrientationOption(code: string | undefined) {
  return PROFILE_ORIENTATION_OPTIONS.find(option => option.code === code);
}

export function coupleOrientationLabels(identityCode: string): readonly [string, string] {
  return identityCode === 'casal-ele-ela'
    ? ['Orientação dele', 'Orientação dela']
    : ['Orientação da pessoa 1', 'Orientação da pessoa 2'];
}
