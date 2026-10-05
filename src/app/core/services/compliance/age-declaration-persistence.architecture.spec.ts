import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(process.cwd());

function source(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

describe('Adult declaration persistence boundary', () => {
  it('restaura autodeclaração válida a partir da evidência backend imutável', () => {
    const refresh = source(
      'functions/src/compliance/refresh-my-age-eligibility.handler.ts'
    );

    expect(refresh).toContain('adult_self_declarations');
    expect(refresh).toContain('trustedSelfDeclarationAtMs');
    expect(refresh).toContain('age_eligibility.self_declaration_restored');
    expect(refresh).toContain('restoredFromDeclarationEvidence');
    expect(refresh).toContain("status: 'SELF_DECLARED_ADULT'");
  });

  it('não reaproveita por nome um SELF_DECLARED_ADULT inválido', () => {
    const refresh = source(
      'functions/src/compliance/refresh-my-age-eligibility.handler.ts'
    );

    expect(refresh).toContain(
      "currentDecision.status === 'SELF_DECLARED_ADULT'"
    );
    expect(refresh).toContain('currentDecision.allowed === true');
  });

  it('faz ponte imediata da projeção retornada pela callable', () => {
    const service = source(
      'src/app/core/services/compliance/age-eligibility.service.ts'
    );

    expect(service).toContain('response.data.ageEligibility');
    expect(service).toContain('trustedSessionProjection.next');
    expect(service).toContain('getLoggedUserUIDSnapshot');
  });

  it('reconcilia a projeção persistida e mantém a decisão etária dentro do onboarding', () => {
    const service = source(
      'src/app/core/services/compliance/age-eligibility.service.ts'
    );
    const registerFlow = source(
      'src/app/register-module/data-access/register-flow.facade.ts'
    );
    const routing = source('src/app/app-routing.module.ts');

    expect(service).toContain('refreshTrustedSources
  it('não mostra nova confirmação enquanto reconcilia o estado já salvo', () => {
    const component = source(
      'src/app/compliance/age-verification-page/age-verification-page.component.ts'
    );
    const template = source(
      'src/app/compliance/age-verification-page/age-verification-page.component.html'
    );

    expect(component).toContain('reconciling = signal(true)');
    expect(component).toContain('refreshTrustedSources$()');
    expect(component).toContain(
      'finalize(() => this.reconciling.set(false))'
    );
    expect(template).toContain(
      'Verificando sua confirmação já registrada'
    );
    expect(template).toContain('Você não precisa');
    expect(template).toContain('Essa declaração não equivale à');
  });
});
);
    expect(service).toContain('trustedSessionProjection');
    expect(registerFlow).toContain('this.ageEligibility.current
  it('não mostra nova confirmação enquanto reconcilia o estado já salvo', () => {
    const component = source(
      'src/app/compliance/age-verification-page/age-verification-page.component.ts'
    );
    const template = source(
      'src/app/compliance/age-verification-page/age-verification-page.component.html'
    );

    expect(component).toContain('reconciling = signal(true)');
    expect(component).toContain('refreshTrustedSources$()');
    expect(component).toContain(
      'finalize(() => this.reconciling.set(false))'
    );
    expect(template).toContain(
      'Verificando sua confirmação já registrada'
    );
    expect(template).toContain('Você não precisa');
    expect(template).toContain('Essa declaração não equivale à');
  });
});
);
    expect(registerFlow).toContain("state.status === 'SELF_DECLARED_ADULT'");
    expect(registerFlow).toContain("state.status === 'VERIFIED_ADULT'");
    expect(routing).not.toContain('ageEligibilityGuard');
    expect(routing).not.toContain('ageReverificationGuard');
  });

  it('não mostra nova confirmação enquanto reconcilia o estado já salvo', () => {
    const component = source(
      'src/app/compliance/age-verification-page/age-verification-page.component.ts'
    );
    const template = source(
      'src/app/compliance/age-verification-page/age-verification-page.component.html'
    );

    expect(component).toContain('reconciling = signal(true)');
    expect(component).toContain('refreshTrustedSources$()');
    expect(component).toContain(
      'finalize(() => this.reconciling.set(false))'
    );
    expect(template).toContain(
      'Verificando sua confirmação já registrada'
    );
    expect(template).toContain('Você não precisa');
    expect(template).toContain('Essa declaração não equivale à');
  });
});
