import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/messaging/direct-chat/services/direct-chat-availability.service.ts'),
  'utf8'
).replace(/\r\n/g, '\n');

const coordinatorSource = readFileSync(
  resolve(process.cwd(), 'src/app/messaging/direct-chat/services/direct-chat-reconciliation-coordinator.ts'),
  'utf8'
).replace(/\r\n/g, '\n');

describe('DirectChatAvailability reconciliation boundary', () => {
  it('exige snapshot versionado e booleano antes de liberar abertura', () => {
    expect(source).toContain("projection?.version === 1 && typeof projection.available === 'boolean'");
    expect(source).toContain('return of(projection.available)');
    expect(source).toContain('return this.reconcile$(owner, peer)');
  });

  it('coalesce solicitações por par e limita novas tentativas', () => {
    expect(coordinatorSource).toContain('JSON.stringify([owner, peer])');
    expect(coordinatorSource).toContain('this.inFlight.get(key)');
    expect(coordinatorSource).toContain('this.inFlight.set(key, pending)');
    expect(coordinatorSource).toContain('retryAfterMs = 60_000');
    expect(coordinatorSource).toContain('this.lastAttempt.size >= this.maxAttemptEntries');
  });

  it('não usa sucesso do callable como autorização de acesso', () => {
    expect(source).toContain('switchMap(() => of(false))');
    expect(source).toContain('catchError(() => of(false))');
    expect(source).not.toContain('of(true)');
  });
});
