import { beforeUserCreated } from 'firebase-functions/v2/identity';
import { HttpsError } from 'firebase-functions/v2/https';

import {
  requiresTrustedAdultVerification,
  TRUSTED_AGE_VERIFICATION_REQUIRED,
} from '../compliance/registration-age-admission.policy';
import { FUNCTIONS_REGION } from '../config/functions-region';

/**
 * O modo verificado reserva o provisionamento ao backend. Quando o emissor
 * for integrado, o backend deverá validar a prova antes de criar a conta.
 * O evento só registra uma função em projetos que ativarem esse modo.
 */
export const blockDirectAuthRegistration = requiresTrustedAdultVerification
  ? beforeUserCreated({ region: FUNCTIONS_REGION }, () => {
    throw new HttpsError('permission-denied', 'Conclua a verificação confiável de maioridade antes de criar a conta.', {
      reason: TRUSTED_AGE_VERIFICATION_REQUIRED,
    });
  })
  : undefined;
