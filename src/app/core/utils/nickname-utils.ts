// src/app/core/utils/nickname-utils.ts

/**
 * Utilitário para composição e manipulação de apelidos (nicknames) no projeto.
 * Este módulo é centralizado e preparado para evoluir conforme as regras de negócio futuras.
 */

export namespace NicknameUtils {
  /**
   * Monta o apelido completo unindo o principal e o complemento.
   * Ambos os campos são limpos e convertidos para lowercase para padronização.
   * Exemplo: "Joao" + "Oficial" => "joao oficial"
   */
  export function montarApelidoCompleto(principal: string, complemento: string): string {
    const nome = (principal || '').trim();
    const sufixo = (complemento || '').trim();
    return `${nome} ${sufixo}`.trim().toLowerCase();
  }

  /**
   * Normaliza o apelido completo para buscas ou comparações,
   * removendo espaços duplicados e padronizando caracteres especiais no futuro.
   */
  export function normalizarApelido(apelido: string): string {
    return apelido.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  /**
   * Verifica se o apelido completo é válido para uso (sem validações assíncronas).
   * Ideal para pré-validação antes de enviar ao servidor.
   */
  export function isApelidoValido(apelido: string): boolean {
    const regex = /^[a-zA-Z0-9!@#$%^&*()_+\-= ]{4,24}$/;
    return regex.test(apelido.trim());
  }

  /**
   * Futuro: poderá aplicar máscaras, filtros ou transliteração
   * Exemplo: "joão" -> "joao", "!usuário" -> "usuario"
   */
  export function limparCaracteresEspeciais(apelido: string): string {
    return apelido.normalize('NFD').replace(/[^\w\s]/gi, '').trim();
  }

  /**
   * Futuro: pode gerar sugestão de apelido baseado em nome + número randômico
   */
  export function gerarSugestaoApelido(base: string): string {
    const rand = Math.floor(100 + Math.random() * 900);
    return `${base}${rand}`.toLowerCase();
  }
}

// Para uso externo, importe com:
// import { NicknameUtils } from 'src/app/core/utils/nickname-utils';
