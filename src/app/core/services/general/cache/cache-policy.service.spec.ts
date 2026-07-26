import { TestBed } from '@angular/core/testing';

import { CachePolicyService } from './cache-policy.service';

describe('CachePolicyService', () => {
  let service: CachePolicyService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(CachePolicyService);
  });

  it('aplica política efêmera e não persistente para buscas', () => {
    expect(service.resolve('search:user-1:hash')).toEqual({
      ttlMs: 300_000,
      persist: false,
      matchedBy: 'prefix:search:',
    });
  });

  it('preserva payloads SWR de preferências sem expiração automática', () => {
    expect(service.resolve('preferences:user-1')).toEqual({
      ttlMs: null,
      persist: true,
      matchedBy: 'prefix:preferences:',
    });
  });

  it('prioriza TTL e persistência informados pelo consumidor', () => {
    expect(service.resolve('search:user-1:hash', 20_000, true)).toEqual({
      ttlMs: 20_000,
      persist: true,
      matchedBy: 'prefix:search:',
    });
  });

  it('mantém comportamento histórico para chave sem política', () => {
    expect(service.resolve('custom:feature')).toEqual({
      ttlMs: null,
      persist: true,
      matchedBy: 'default',
    });
  });
});
