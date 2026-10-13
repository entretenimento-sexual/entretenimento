import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(process.cwd());

function source(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

describe('Account 18+ admission and age assurance boundary', () => {
  it('preserva autodeclaração histórica sem transformá-la em autorização', () => {
    const refresh = source(
      'functions/src/compliance/refresh-my-age-eligibility.handler.ts'
    );
    const access = source(
      'functions/src/account_lifecycle/interaction-access.policy.ts'
    );

    expect(refresh).toContain('adult_self_declarations');
    expect(refresh).toContain("status: 'SELF_DECLARED_ADULT'");
    expect(access).toContain('assertPlatformAccountAccessData');
    expect(access).toContain('interactionBlocked');
    expect(access).not.toContain('isTrustedAdultAgeDecision');
    expect(access).not.toContain("'verification_required'");
  });

  it('reconcilia uma vez por sessão antes de decidir o onboarding', () => {
    const service = source(
      'src/app/core/services/compliance/age-eligibility.service.ts'
    );
    const registerFlow = source(
      'src/app/register-module/data-access/register-flow.facade.ts'
    );

    expect(service).toContain('reconcileTrustedStateOncePerSession$');
    expect(service).toContain('reconciledUid');
    expect(registerFlow).toContain(
      'reconcileTrustedStateOncePerSession$()'
    );
    expect(registerFlow).toContain(
      'isCurrentAdultAccountAdmissionProjection(ageState)'
    );
    expect(registerFlow).not.toContain(
      'isCurrentTrustedAdultAgeProjection(ageState)'
    );
    expect(registerFlow).toContain(
      'if (user?.profileCompleted === true)'
    );
  });

  it('não pede autodeclaração novamente na tela de verificação', () => {
    const component = source(
      'src/app/compliance/age-verification-page/age-verification-page.component.ts'
    );
    const template = source(
      'src/app/compliance/age-verification-page/age-verification-page.component.html'
    );

    // A declaração válida já registrada avança automaticamente.
    // A primeira declaração só é oferecida a quem ainda não foi admitido.
    // Revisão forte não pode ser uma exigência implícita do onboarding.
    expect(component).toContain('isCurrentAdultAccountAdmissionProjection(state)');
    expect(component).toContain('this.continued = true');
    expect(component).toContain('acceptSelfDeclaration$()');
    expect(component).not.toContain('requestInitialReview$()');
    expect(template).toContain('@if (vm.accessAllowed)');
    expect(template).toContain('@else if (vm.deniedUnderage)');
    expect(template).toContain('@else if (vm.reviewRequired)');
    expect(template).toContain('(click)="confirmAdult()"');
    expect(template).not.toContain('(click)="requestInitialReview()"');
  });

  it('mantém rotas sem age guard duplicado por feature', () => {
    const routing = source('src/app/app-routing.module.ts');

    expect(routing).not.toContain('ageEligibilityGuard');
    expect(routing).not.toContain('ageReverificationGuard');
    expect(routing).toContain('adultContentConsentGuard');
  });
});
