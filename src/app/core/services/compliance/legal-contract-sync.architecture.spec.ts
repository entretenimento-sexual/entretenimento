import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = resolve(process.cwd());

function source(path: string): string {
  return readFileSync(resolve(ROOT, path), 'utf8');
}

describe('Legal contract sync', () => {
  it('mantém frontend e backend na mesma versão contratual', () => {
    const frontend = source(
      'src/app/core/services/compliance/platform-legal.constants.ts'
    );
    const backend = source(
      'functions/src/compliance/platform-legal.constants.ts'
    );

    for (const literal of [
      "TERMS_ACCEPTANCE_VERSION = 'v3'",
      "TERMS_DOCUMENT_VERSION = '2026-09-29.1'",
      "PRIVACY_NOTICE_VERSION = '2026-09-29.1'",
      "PLATFORM_LEGAL_EFFECTIVE_DATE_ISO = '2026-09-29'",
    ]) {
      expect(frontend).toContain(literal);
      expect(backend).toContain(literal);
    }
  });

  it('mantém Media juridicamente descrita como superfície de maioridade verificada', () => {
    const terms = source(
      'src/app/footer/legal-footer/termos-e-condicoes/termos-e-condicoes.component.html'
    );
    const privacy = source(
      'src/app/footer/legal-footer/politica-de-privacidade/politica-de-privacidade.component.html'
    );

    expect(terms).toContain(
      'não é suficiente, por si só, para autorizar upload, publicação, reprodução ou consumo de mídia adulta'
    );
    expect(privacy).toContain(
      'Upload, publicação, reprodução e consumo de mídia adulta exigem estado de maioridade verificada'
    );
  });

  it('não promete cobrança recorrente real antes da habilitação operacional', () => {
    const terms = source(
      'src/app/footer/legal-footer/termos-e-condicoes/termos-e-condicoes.component.html'
    );
    const runtime = source(
      'functions/src/payments/config/asaas.config.ts'
    );

    expect(terms).toContain(
      'a cobrança recorrente real em produção permanece desabilitada'
    );
    expect(runtime).toContain('ASAAS_RECURRING_ENABLED');
    expect(runtime).toContain('recurring_billing_not_enabled');
  });

  it('mantém a política de privacidade coerente com integrações ativas', () => {
    const privacy = source(
      'src/app/footer/legal-footer/politica-de-privacidade/politica-de-privacidade.component.html'
    );

    expect(privacy).toContain('Google/Firebase');
    expect(privacy).toContain('Google Analytics não é inicializado');
    expect(privacy).toContain('Sentry e VirusTotal permanecem desativados');
    expect(privacy).toContain('/politica-de-cookies');
  });
});
