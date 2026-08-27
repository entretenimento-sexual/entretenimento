import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';

/**
 * Replacement exclusivo do harness visual de `/descobrir`.
 *
 * SUPRESSÃO EXPLÍCITA:
 * - não chama `ensureCurrentLegalNotice` durante a inspeção visual.
 *
 * Motivo:
 * o usuário do harness é fictício e não possui aceite jurídico persistido.
 * A chamada real geraria erro de autenticação/CORS sem relação com layout,
 * acessibilidade ou estados do feed. O serviço real continua intacto e é
 * exercitado pelos builds/testes normais executados antes do harness.
 */
@Injectable({ providedIn: 'root' })
export class LegalUpdateNoticeService {
  watchAndEnsure$(): Observable<void> {
    return of(void 0);
  }
}
