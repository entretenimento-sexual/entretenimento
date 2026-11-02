// Callable for pre-auth nickname feedback. Never return UID, email, or
// technical index documents. App Check and centralized rate limiting apply.
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import { assertCallableAppCheck } from '../shared/security/callable-app-check';
import { consumeBackendRateLimitQuota } from '../shared/security/backend-rate-limit.service';
import { normalizeRegistrationNickname } from './nickname-reservation.policy';
import {
  resolvePublicNicknameAvailability,
  type PublicNicknameAvailability,
} from './registration-nickname-availability.policy';

const AVAILABILITY_QUOTA = Object.freeze({
  burstWindowMs: 60_000,
  burstMax: 10,
  sustainedWindowMs: 60 * 60_000,
  sustainedMax: 80,
});

export const getRegistrationNicknameAvailability = onCall<{ nickname?: unknown }>(
  { region: FUNCTIONS_REGION },
  async (request): Promise<{ status: PublicNicknameAvailability }> => {
    assertCallableAppCheck(request.app);
    const nickname = normalizeRegistrationNickname(request.data?.nickname);
    if (!nickname) {
      throw new HttpsError('invalid-argument', 'Informe um apelido válido.');
    }
    // Use the platform socket IP, not caller-supplied forwarded headers.
    // The backend limiter hashes the subject and has a finite expiration.
    const subject = String(request.rawRequest?.ip ?? '').trim();
    if (!subject) {
      throw new HttpsError('failed-precondition',
        'Consulta temporariamente indisponível.');
    }
    await consumeBackendRateLimitQuota({
      action: 'registration-nickname-availability',
      subject,
      config: AVAILABILITY_QUOTA,
      message: 'Muitas consultas de apelido. Tente novamente mais tarde.',
    });

    const index = await db.collection('public_index')
      .doc('nickname:' + nickname.key).get();
    if (!index.exists || index.get('type') !== 'nickname' ||
      index.get('value') !== nickname.key) {
      return { status: 'unconfirmed' };
    }
    const uid = index.get('uid');
    if (typeof uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(uid)) {
      return { status: 'unconfirmed' };
    }
    const [owner, profile] = await db.getAll(
      db.collection('users').doc(uid),
      db.collection('public_profiles').doc(uid)
    );
    return {
      status: resolvePublicNicknameAvailability({
        key: nickname.key,
        index: index.data(),
        owner: owner.data(),
        publicProfile: profile.data(),
      }),
    };
  }
);
