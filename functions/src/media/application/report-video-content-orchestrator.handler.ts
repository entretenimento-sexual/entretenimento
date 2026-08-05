import { onCall } from 'firebase-functions/v2/https';

import {
  assertAccountOperationalAccess,
} from '../../account_lifecycle/account-operational-access.policy';
import { FUNCTIONS_REGION } from '../../config/functions-region';
import {
  reportVideoContent as reportVideoContentCore,
} from './report-video-content.handler';

/**
 * A denúncia continua sendo uma ação de segurança, mas o alvo só pode ser
 * alcançado por uma sessão de mídia pública operacional. Canais jurídicos e de
 * recurso da conta permanecem fora do módulo media.
 */
export const reportVideoContent = onCall(
  { region: FUNCTIONS_REGION },
  async (request) => {
    const reporterUid = String(request.auth?.uid ?? '').trim();

    if (reporterUid) {
      await assertAccountOperationalAccess(
        reporterUid,
        'MEDIA_VIEW_PUBLIC'
      );
    }

    return reportVideoContentCore.run(request as any);
  }
);
