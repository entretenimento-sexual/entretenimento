// src/app/core/utils/nickname-utils.ts
export function montarApelidoCompleto(principal: string, complemento: string): string {
  return `${principal?.trim()} ${complemento?.trim()}`.trim().toLowerCase();
}
