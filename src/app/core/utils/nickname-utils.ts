// src/app/core/utils/nickname-utils.ts

/**
 * =============================================================================
 * NicknameUtils
 * -----------------------------------------------------------------------------
 * Objetivo:
 * Composição, normalização e validação local do apelido no formulário.
 * A titularidade e a chave persistida são decididas pelas Functions.
 *
 * IMPORTANTE (conceito):
 * - "DISPLAY"  => o apelido "bonito" que o usuário digita e vê (pode ter espaço).
 * - "KEY" => forma normalizada para validação e cache local.
 *
 * Estratégia adotada:
 * - DISPLAY: mantém espaços simples (colapsa múltiplos) e preserva casing.
 * - KEY: lower + remove acentos + colapsa espaços + converte espaços para "_" e
 *        remove qualquer caractere não permitido em índice.
 *
 * Assim, o usuário pode digitar "João Oficial" (display),
 * e a validação local usa "joao_oficial" (key), compatível com:
 *   /^[a-z0-9._-]{3,40}$/
 * =============================================================================
 */

/* eslint-disable @typescript-eslint/no-namespace */
export namespace NicknameUtils {
  // ---------------------------------------------------------------------------
  // Limites (ajuste conforme regra de negócio)
  // ---------------------------------------------------------------------------

  /** Limites do nickname DISPLAY (ex.: regra do seu register) */
  export const DISPLAY_MIN_LEN = 4;
  export const DISPLAY_PART_MAX_LEN = 12;
  const DISPLAY_LEGACY_MAX_LEN = 2 * DISPLAY_PART_MAX_LEN;
  export const DISPLAY_MAX_LEN = DISPLAY_LEGACY_MAX_LEN + 1;

  /** Limites do nickname KEY (ex.: regra de índice / nicknameNormalized nas rules) */
  export const KEY_MIN_LEN = 3;
  export const KEY_MAX_LEN = 40;

  // ---------------------------------------------------------------------------
  // Regras de caracteres
  // ---------------------------------------------------------------------------

  /**
   * DISPLAY:
   * Permite letras/números e separadores comuns (._-) e espaço.
   * Observação: se você quiser permitir outros símbolos no display, faça com cuidado,
   * porque a KEY (índice) precisará mapear/limpar isso, afetando unicidade.
   */
  const DISPLAY_RE = /^[A-Za-z0-9._\- ]+$/;

  /**
   * KEY/ÍNDICE:
   * Deve bater com a regra de `nicknameNormalized` e docId do public_index.
   */
  const KEY_RE = new RegExp(
    `^[a-z0-9._-]{${KEY_MIN_LEN},${KEY_MAX_LEN}}$`
  );

  // ---------------------------------------------------------------------------
  // Helpers internos
  // ---------------------------------------------------------------------------

  /**
   * Remove espaços duplicados e mantém apenas espaço simples.
   * Ex.: "  João   Oficial  " -> "João Oficial"
   */
  function collapseWhitespace(value: string): string {
    return (value ?? '').toString().trim().replace(/\s+/g, ' ');
  }

  /**
   * Remove diacríticos (acentos) para gerar uma KEY ASCII.
   * Ex.: "João" -> "Joao"
   */
  function removeDiacritics(value: string): string {
    return (value ?? '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  /**
   * Remove tudo que não seja permitido na KEY.
   * Mantém apenas [a-z0-9._-]
   */
  function stripInvalidKeyChars(value: string): string {
    return (value ?? '').replace(/[^a-z0-9._-]/g, '');
  }

  // ---------------------------------------------------------------------------
  // API pública
  // ---------------------------------------------------------------------------

  /**
   * Monta o apelido completo (DISPLAY) unindo o principal e o complemento.
   * - Preserva o casing digitado pelo usuário (melhor UX).
   * - Colapsa espaços duplicados.
   *
   * Ex.: "Joao" + "Oficial" => "Joao Oficial"
   * Ex.: "  Joao  " + ""    => "Joao"
   */
  export function montarApelidoCompleto(principal: string, complemento: string): string {
    const nome = collapseWhitespace(principal || '');
    const sufixo = collapseWhitespace(complemento || '');

    // Junta com espaço somente se houver complemento
    const full = sufixo ? `${nome} ${sufixo}` : nome;
    return collapseWhitespace(full);
  }

  /**
   * Normaliza o apelido DISPLAY para comparação/armazenamento "bonito".
   * - Mantém espaços simples.
   * - Preserva casing.
   *
   * Se você precisar comparar de forma case-insensitive, use:
   * normalizarApelidoParaComparacao().
   */
  export function normalizarApelido(apelido: string): string {
    return collapseWhitespace(apelido || '');
  }

  export function extrairApelidoPrincipal(apelido: string): string {
    return normalizarApelido(apelido).split(' ', 1)[0];
  }

  export function isApelidoDeCadastroValido(apelido: string): boolean {
    const display = normalizarApelido(apelido);
    const parts = display.split(' ');
    return isApelidoValido(display) &&
      parts.length <= 2 && parts[0].length >= DISPLAY_MIN_LEN &&
      parts.every(part => part.length <= DISPLAY_PART_MAX_LEN);
  }

  /**
   * Normaliza o apelido DISPLAY para comparações case-insensitive (UX).
   * - trim + colapsa espaços + lower
   */
  export function normalizarApelidoParaComparacao(apelido: string): string {
    return collapseWhitespace(apelido || '').toLowerCase();
  }

  /**
   * Normaliza para validação local e chaves de cache.
   * - trim + colapsa espaços
   * - remove acentos
   * - lower
   * - converte espaços para "_" (permite "nick complemento" no display)
   * - remove qualquer caractere não permitido no índice
   *
   * Ex.: "João Oficial" => "joao_oficial"
   */
  export function normalizarApelidoParaIndice(apelido: string): string {
    const display = collapseWhitespace(apelido || '');

    // Remove acentos e padroniza
    const ascii = removeDiacritics(display).toLowerCase();

    // Espaço no display vira "_" no índice (compatível com rules)
    const withUnderscore = ascii.replace(/\s+/g, '_');

    // Remove tudo que não pode existir no índice
    const cleaned = stripInvalidKeyChars(withUnderscore);

    return cleaned;
  }

  /**
   * Validação síncrona do apelido DISPLAY (sem checar unicidade).
   * - Usa a regex do DISPLAY
   * - Garante que o tamanho respeita o intervalo
   */
  export function isApelidoValido(apelido: string): boolean {
    const display = normalizarApelido(apelido);
    if (!DISPLAY_RE.test(display)) return false;
    if (display.length >= DISPLAY_MIN_LEN && display.length <= DISPLAY_LEGACY_MAX_LEN) return true;

    // O espaço acrescentado na composição pode ser o 25º caractere.
    const parts = display.split(' ');
    return parts.length === 2 && parts.every(part => part.length === DISPLAY_PART_MAX_LEN);
  }

  /**
   * Validação do apelido KEY (compatibilidade com rules / índice).
   * Útil para garantir que a normalização gerou algo indexável.
   */
  export function isApelidoIndiceValido(apelido: string): boolean {
    const key = normalizarApelidoParaIndice(apelido);
    if (!key) return false;
    if (key.length < KEY_MIN_LEN || key.length > KEY_MAX_LEN) return false;
    return KEY_RE.test(key);
  }

  /**
   * Mantido (legado):
   * Remove caracteres especiais (mais agressivo).
   * Atenção: pode mudar bastante o valor e impactar unicidade se usado como base.
   */
  export function limparCaracteresEspeciais(apelido: string): string {
    return collapseWhitespace(
      (apelido ?? '')
        .normalize('NFD')
        .replace(/[^\w\s]/gi, '')
        .trim()
    );
  }

  /**
   * Gera sugestão simples baseada em uma base (DISPLAY) + número.
   * A base é normalizada para índice e depois convertida para display "seguro".
   * Observação: você pode ajustar para manter espaço, se preferir.
   */
  export function gerarSugestaoApelido(base: string): string {
    const rand = Math.floor(100 + Math.random() * 900);
    const keyBase = normalizarApelidoParaIndice(base);
    const safe = keyBase || 'user';
    return `${safe}${rand}`;
  }
}
