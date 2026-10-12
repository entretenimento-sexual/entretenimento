import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/messaging/direct-chat/services/direct-chat-availability.service.ts'),
  'utf8'
).replace(/\r\n/g, '\n');

describe('DirectChatAvailability reconciliation boundary', () => {
  it('exige snapshot versionado e booleano antes de liberar abertura', () => {
    expect(source).toContain("projection?.version === 1 && typeof projection.available === 'boolean'");
    expect(source).toContain('return of(projection.available)');
    expect(source).toContain('return this.reconcile$(owner, peer)');
  });

  it('coalesce solicitações por par e limita novas tentativas', () => {
    expect(source).toContain('JSON.stringify([owner, peer])');
    expect(source).toContain('this.inFlight.get(key)');
    expect(source).toContain('this.inFlight.set(key, pending)');
    expect(source).toContain('RETRY_AFTER_MS = 60_000');
    expect(source).toContain('this.lastAttempt.size >= 256');
  });

  it('não usa sucesso do callable como autorização de acesso', () => {
    expect(source).toContain('from(pending).pipe(switchMap(() => of(false)))');
    expect(source).toContain('catchError(() => of(false))');
    expect(source).not.toContain('of(true)');
  });
});
