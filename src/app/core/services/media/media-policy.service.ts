// src/app/core/services/media/media-policy.service.ts
// Policy mínima para fotos (MVP).
// - Agora: somente "dono do perfil" pode ver e fazer upload (seguro por padrão).
// - Futuro: expandir para friends/subscriber/role/blocked/reports/age-gate.
import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';

export type MediaPolicyDecision = 'ALLOW' | 'DENY';

export interface IMediaPolicyResult {
  decision: MediaPolicyDecision;
  reason?: 'NOT_AUTHENTICATED' | 'NOT_OWNER' | 'BLOCKED' | 'SUBSCRIPTION_REQUIRED' | 'UNKNOWN';
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
   * Motivo: no seu domínio (adulto), default seguro evita vazamento por engano.
   */
  canViewProfilePhotos$(viewerUid: string | null, ownerUid: string): Observable<IMediaPolicyResult> {
    if (!viewerUid) return this.deny$('NOT_AUTHENTICATED');
    if (viewerUid !== ownerUid) return this.deny$('NOT_OWNER');
    return this.allow$();
  }

  /**
   * Upload: também só o dono (por enquanto).
   * Futuro: exigir VERIFIED/PROFILE_COMPLETE/assinatura etc.
   */
  canUploadProfilePhotos$(viewerUid: string | null, ownerUid: string): Observable<IMediaPolicyResult> {
    if (!viewerUid) return this.deny$('NOT_AUTHENTICATED');
    if (viewerUid !== ownerUid) return this.deny$('NOT_OWNER');
    return this.allow$();
  }
}
