import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Observable, defer, from, map, of } from 'rxjs';

export type CommunityDistributionTelemetrySurface =
  | 'social_explore_recommendation'
  | 'social_explore_activity'
  | 'social_explore_content';

export type CommunityDistributionTelemetryEventType =
  | 'qualified_exposure'
  | 'open';

export interface CommunityDistributionTelemetryEvent {
  readonly communityId: string;
  readonly surface: CommunityDistributionTelemetrySurface;
  readonly eventType: CommunityDistributionTelemetryEventType;
}

export interface CommunityDistributionTelemetryResponse {
  readonly accepted: number;
  readonly generatedAt: number;
}

const MAX_BATCH_SIZE = 12;
const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const SURFACES = new Set<CommunityDistributionTelemetrySurface>([
  'social_explore_recommendation',
  'social_explore_activity',
  'social_explore_content',
]);
const EVENT_TYPES = new Set<CommunityDistributionTelemetryEventType>([
  'qualified_exposure',
  'open',
]);

function normalizeResponse(
  raw: unknown,
  submittedCount: number
): CommunityDistributionTelemetryResponse {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {};
  const accepted = Math.trunc(Number(source['accepted']));
  const generatedAt = Math.trunc(Number(source['generatedAt']));

  return {
    accepted: Number.isFinite(accepted)
      ? Math.min(Math.max(accepted, 0), submittedCount)
      : 0,
    generatedAt: Number.isFinite(generatedAt) && generatedAt > 0
      ? generatedAt
      : Date.now(),
  };
}

function normalizeEvents(
  events: readonly CommunityDistributionTelemetryEvent[]
): readonly CommunityDistributionTelemetryEvent[] {
  const normalized: CommunityDistributionTelemetryEvent[] = [];
  const seen = new Set<string>();

  for (const event of events) {
    const communityId = String(event.communityId ?? '').trim();
    if (
      !SAFE_ID_PATTERN.test(communityId)
      || !SURFACES.has(event.surface)
      || !EVENT_TYPES.has(event.eventType)
    ) {
      continue;
    }

    const key = `${communityId}:${event.surface}:${event.eventType}`;
    if (seen.has(key)) continue;

    seen.add(key);
    normalized.push({
      communityId,
      surface: event.surface,
      eventType: event.eventType,
    });

    if (normalized.length >= MAX_BATCH_SIZE) break;
  }

  return normalized;
}

@Injectable({ providedIn: 'root' })
export class CommunityDistributionTelemetryRepository {
  private readonly functions = inject(Functions);
  private readonly recordCallable = httpsCallable<
    { events: readonly CommunityDistributionTelemetryEvent[] },
    unknown
  >(this.functions, 'recordCommunityDistributionEvents');

  recordEvents$(
    events: readonly CommunityDistributionTelemetryEvent[]
  ): Observable<CommunityDistributionTelemetryResponse> {
    const normalized = normalizeEvents(events);

    if (normalized.length === 0) {
      return of({ accepted: 0, generatedAt: Date.now() });
    }

    return defer(() => from(this.recordCallable({ events: normalized }))).pipe(
      map((result) => normalizeResponse(result.data, normalized.length))
    );
  }
}
