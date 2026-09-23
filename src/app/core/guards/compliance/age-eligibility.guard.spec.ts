import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AgeEligibilityService } from '../../services/compliance/age-eligibility.service';
import { ageEligibilityGuard } from './age-eligibility.guard';

describe('ageEligibilityGuard', () => {
  let verifiedAdult$: BehaviorSubject<boolean>;
  let createUrlTree: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    verifiedAdult$ = new BehaviorSubject<boolean>(false);
    createUrlTree = vi.fn((commands, options) => ({ commands, options }));

    TestBed.configureTestingModule({
      providers: [
        {
          provide: Router,
          useValue: { createUrlTree },
        },
        {
          provide: AgeEligibilityService,
          useValue: {
            verifiedAdult$: verifiedAdult$.asObservable(),
          },
        },
      ],
    });
  });

  it('redireciona para uma única etapa de verificação preservando o destino', async () => {
    const result = TestBed.runInInjectionContext(() =>
      ageEligibilityGuard(
        {} as never,
        { url: '/dashboard/principal' } as never
      )
    );

    await firstValueFrom(result as never);

    expect(createUrlTree).toHaveBeenCalledWith(
      ['/adulto/verificar-idade'],
      {
        queryParams: {
          redirectTo: '/dashboard/principal',
        },
      }
    );
  });

  it('libera imediatamente quando a projeção etária válida está ativa', async () => {
    verifiedAdult$.next(true);

    const result = TestBed.runInInjectionContext(() =>
      ageEligibilityGuard(
        {} as never,
        { url: '/friends' } as never
      )
    );

    await expect(firstValueFrom(result as never)).resolves.toBe(true);
    expect(createUrlTree).not.toHaveBeenCalled();
  });
});
