// src/app/core/services/media/media-policy.service.ts
// Policy mínima para fotos (MVP).
// - Agora: somente "dono do perfil" pode ver a biblioteca privada.
// - Upload exige dono, e-mail verificado e perfil concluído.
// - Futuro: expandir para friends/subscriber/role/blocked/reports/age-gate.
import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';

export type MediaPolicyDecision = 'ALLOW' | 'DENY';

export type MediaPolicyDenyReason =
  | 'NOT_AUTHENTICATED'
  | 'NOT_OWNER'
  | 'EMAIL_UNVERIFIED'
  | 'PROFILE_INCOMPLETE'
  | 'INTERACTION_BLOCKED'
  | 'BLOCKED'
  | 'SUBSCRIPTION_REQUIRED'
  | 'UNKNOWN';

export interface IMediaPolicyResult {
  decision: MediaPolicyDecision;
  reason?: MediaPolicyDenyReason;
}

export interface IMediaPolicyViewerSnapshot {
  uid?: string | null;
  emailVerified?: boolean | null;
  profileCompleted?: boolean | null;
  interactionBlocked?: boolean | null;
}

@Injectable({ providedIn: 'root' })
export class MediaPolicyService {
  // Helpers para evitar “widening” e padronizar retornos
  private allow$(): Observable<IMediaPolicyResult> {
    return of<IMediaPolicyResult>({ decision: 'ALLOW' });
  }

  private deny$(reason: NonNullable<IMediaPolicyResult['reason']>): Observable<IMediaPolicyResult> {
    return of<IMediaPolicyResult>({ decision: 'DENY', reason });
  }

  /**
   * Regra atual (MVP): só o dono do perfil pode ver "Minhas fotos".
   * Motivo: no domínio adulto, default seguro evita vazamento por engano.
   */
  canViewProfilePhotos$(viewerUid: string | null, ownerUid: string): Observable<IMediaPolicyResult> {
    const safeViewerUid = (viewerUid ?? '').trim();
    const safeOwnerUid = (ownerUid ?? '').trim();

    if (!safeViewerUid) return this.deny$('NOT_AUTHENTICATED');
    if (!safeOwnerUid || safeViewerUid !== safeOwnerUid) return this.deny$('NOT_OWNER');
    return this.allow$();
  }

  /**
   * Compatibilidade com chamadas antigas que ainda informam apenas UID.
   * Mantida para não quebrar componentes que só precisam validar ownership.
   */
  canUploadProfilePhotos$(viewerUid: string | null, ownerUid: string): Observable<IMediaPolicyResult> {
    const safeViewerUid = (viewerUid ?? '').trim();
    const safeOwnerUid = (ownerUid ?? '').trim();

    if (!safeViewerUid) return this.deny$('NOT_AUTHENTICATED');
    if (!safeOwnerUid || safeViewerUid !== safeOwnerUid) return this.deny$('NOT_OWNER');
    return this.allow$();
  }

  /**
   * Upload endurecido para a plataforma adulta.
   *
   * Regras:
   * - exige sessão/perfil runtime resolvido;
   * - exige que o usuário seja dono do perfil;
   * - exige e-mail verificado;
   * - exige cadastro finalizado;
   * - bloqueia usuário com interação administrativamente bloqueada.
   *
   * A rota /media já passa por authGuard + accountLifecycleGuard, mas esta policy
   * mantém defesa em profundidade no ponto de ação.
   */
  canUploadProfilePhotosForViewer$(
    viewer: IMediaPolicyViewerSnapshot | null | undefined,
    ownerUid: string
  ): Observable<IMediaPolicyResult> {
    if (viewer === undefined) return this.deny$('UNKNOWN');

    const safeViewerUid = (viewer?.uid ?? '').trim();
    const safeOwnerUid = (ownerUid ?? '').trim();

    if (!safeViewerUid) return this.deny$('NOT_AUTHENTICATED');
    if (!safeOwnerUid || safeViewerUid !== safeOwnerUid) return this.deny$('NOT_OWNER');
    if (viewer?.interactionBlocked === true) return this.deny$('INTERACTION_BLOCKED');
    if (viewer?.emailVerified !== true) return this.deny$('EMAIL_UNVERIFIED');
    if (viewer?.profileCompleted !== true) return this.deny$('PROFILE_INCOMPLETE');

    return this.allow$();
  }
}
