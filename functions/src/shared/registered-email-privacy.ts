/** Detects a verbatim account email copied into a text field. */
export function containsRegisteredEmail(value: unknown, email: unknown): boolean {
  if (typeof value !== 'string' || typeof email !== 'string') return false;
  const normalizedEmail = email.trim().toLowerCase();
  return normalizedEmail.length > 0 && value.toLowerCase().includes(normalizedEmail);
}
