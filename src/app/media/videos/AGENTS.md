# Diretrizes obrigatórias — vídeos, inclusive captura pela câmera

Este módulo implementa **publicações sociais de vídeo**, não um drive privado ou backup de gravações. Antes de alterar upload, câmera, editor, pós-processamento, moderação, player, exclusão ou Storage, ler:

- [Diretrizes permanentes de fotos e vídeos](../photos/DIRETRIZES-MIDIAS-PUBLICADAS.md)
- [Instruções do módulo de fotos](../photos/AGENTS.md)

## Regras para gravações da câmera

- A opção "Gravar vídeo com a câmera" deve usar a captura **nativa local** quando disponível e produzir um `File` para o fluxo existente de seleção, preview, edição e publicação.
- **Capturar não é publicar.** Não enviar bytes, abrir biblioteca privada ou armazenar rascunhos remotos só por iniciar/terminar a gravação.
- Pedir autorização de acesso à câmera somente mediante ação explícita do usuário. Atributo `capture="environment"` é uma preferência e pode ter fallback para seletor de arquivo.
- Formato, duração, tamanho, permissões e moderação continuam sendo validados pelas mesmas políticas e pelo backend, sem atalhos específicos da câmera.
- Publicações ativas devem ter audiência social além do proprietário; novas modalidades exigem autorização no backend. Nunca adicionar `ONLY_ME` ou rascunho remoto permanente.
- O arquivo final publicado é o único objeto físico ativo após a limpeza operacional. Staging, posters temporários e artefatos de transcodificação têm prazos e limpeza; nenhuma versão antiga deve persistir como benefício de armazenamento.
- Preservar retenções legais e evidências independentes. Nunca fazer exclusão em massa de originais legados sem migrar dependências de edição, processamento, vídeo em rotação, publicação e exclusão segura por geração.
- Manter Observables/RxJS, cancelamento de sessões, acessibilidade, tratamento de erro centralizado e testes de mídia.

**Dívida técnica conhecida:** o pipeline de vídeo ainda utiliza upload temporário e processamento no servidor. Isso não autoriza armazenamento definitivo de versões, nem transforma o vídeo em item privado do usuário.
