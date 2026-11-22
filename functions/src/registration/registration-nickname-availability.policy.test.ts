import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolvePublicNicknameAvailability as availability } from './registration-nickname-availability.policy';

const nickname = { key: 'zapzap', display: 'Zapzap' };

function firestore({
  indexed = false, storedOwners = [], aliases = [], displays = [], privateAliases = [],
}: {
  indexed?: boolean;
  storedOwners?: string[];
  aliases?: string[];
  displays?: string[];
  privateAliases?: { id: string; display: string }[];
} = {}) {
  const reads: string[] = [];
  const db = {
    collection(name: string) {
      let orderedBy: unknown;
      return {
        doc(id: string) {
          return { get: async () => {
            reads.push(`${name}/${id}`);
            return { exists: indexed };
          } };
        },
        where() { return this; },
        select() { return this; },
        limit() { return this; },
        orderBy(field: unknown) { orderedBy = field; return this; },
        startAt() { return this; },
        endAt() { return this; },
        async get() {
          reads.push(orderedBy && name === 'users' ? 'users-by-prefix' : name);
          return {
            docs: name === 'users'
              ? orderedBy
                ? privateAliases.map(({ id, display }) => ({ id, get: () => display }))
                : storedOwners.map(id => ({ id }))
              : aliases.map(uid => ({ get: () => uid })),
          };
        },
      };
    },
    async getAll() {
      reads.push('alias-owner-display');
      return displays.map(display => ({ get: () => display }));
    },
  } as unknown as FirebaseFirestore.Firestore;
  return { db, reads };
}

test('an occupied index is unavailable even without a public profile', async () => {
  const { db, reads } = firestore({ indexed: true });
  assert.equal(await availability(db, nickname), 'taken');
  assert.deepEqual(reads, ['public_index/nickname:zapzap']);
});

test('an owner without a public index keeps the principal', async () => {
  const { db, reads } = firestore({ storedOwners: ['owner'] });
  assert.equal(await availability(db, nickname), 'taken');
  assert.deepEqual(reads, ['public_index/nickname:zapzap', 'users']);
});

test('a legacy alias blocks signup only if it represents the same principal', async () => {
  assert.equal(await availability(
    firestore({ aliases: ['owner'], displays: ['Zapzap Oficial'] }).db, nickname,
  ), 'taken');
  assert.equal(await availability(
    firestore({ aliases: ['owner'], displays: ['Zapzap_Oficial'] }).db, nickname,
  ), 'available');
});

test('a free principal is confirmed explicitly', async () => {
  const { db, reads } = firestore();
  assert.equal(await availability(db, nickname), 'available');
  assert.deepEqual(reads, ['public_index/nickname:zapzap', 'users', 'users-by-prefix', 'public_index']);
});

test('a historical owner keeps the principal even without the old combined public index', async () => {
  assert.equal(await availability(firestore({
    privateAliases: [{ id: 'owner', display: 'Zapzap Oficial' }],
  }).db, nickname), 'taken');
  assert.equal(await availability(firestore({
    privateAliases: [{ id: 'owner', display: 'Zapzap_Oficial' }],
  }).db, nickname), 'available');
});

test('a saturated alias lookup never reports the principal as available', async () => {
  const privateAliases = Array.from({ length: 101 }, (_, index) => ({
    id: `owner-${index}`, display: `Zapzap_${index}`,
  }));
  await assert.rejects(availability(firestore({ privateAliases }).db, nickname), { code: 'unavailable' });
});
