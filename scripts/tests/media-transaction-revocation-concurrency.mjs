// Bounded runner for independent Firestore E2E revocation cases.
// Fail closed after all in-flight cases settle; never terminate the shared
// emulator client while another case is still testing a transaction.
export async function runBoundedRevocationCases(cases, execute, concurrency = 3) {
  if (!Array.isArray(cases) || typeof execute !== 'function' ||
      !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
    throw new TypeError('Invalid revocation concurrency configuration.');
  }

  let next = 0;
  const failures = [];
  async function worker() {
    while (next < cases.length) {
      const index = next++;
      try {
        await execute(cases[index]);
      } catch (error) {
        failures.push(error);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, cases.length) }, () => worker())
  );
  if (failures.length) {
    throw new AggregateError(
      failures,
      failures.length + ' revocation case(s) failed.'
    );
  }
}
