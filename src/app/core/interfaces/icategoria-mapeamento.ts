// src\app\core\interfaces\icategoria-mapeamento.ts
export interface ICategoriaMapeamento {
  genero: string[];
  praticaSexual: string[];
  preferenciaFisica: string[];
  relacionamento: string[];
  etnia: string[];
}

export const mapeamentoCategorias: ICategoriaMapeamento = {
  genero: ['homens', 'mulheres', 'casais-ele-ele', 'casais-ele-ela', 'casais-ela-ela', 'travestis', 'transexuais', 'crossdressers'],
  praticaSexual: ['swing', 'voyeurismo', 'BDSM', 'exibicionismo', 'menage', 'sexoGrupal', 'fantasiasEroticas'],
  preferenciaFisica: ['tipoFisicoAtletico', 'tipoFisicoPlusSize', 'tatuagens', 'piercings', 'dotado'],
  relacionamento: ['amizadeColorida', 'encontrosSemCompromisso', 'relacionamentosCasuais', 'relacionamentosAbertos', 'poliamor'],
  etnia: ['brancos(as)', 'ruivos(as)', 'índios(as)', 'pardos(as)', 'mulatos(as)', 'negros(as)' ]
};
