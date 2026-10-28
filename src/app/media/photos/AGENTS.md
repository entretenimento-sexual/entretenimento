# Instruções obrigatórias para mudanças neste módulo

**Antes de editar qualquer arquivo em `src/app/media/photos/` ou integrar o módulo com serviços/Cloud Functions**, leia integralmente:

- [DIRETRIZES-MIDIAS-PUBLICADAS.md](./DIRETRIZES-MIDIAS-PUBLICADAS.md)

Estas instruções são regras de produto, não sugestões de design:

1. **Nunca criar galeria privada de armazenamento, backup, “somente eu” ou versões persistentes de fotos.** O usuário publica conteúdo social, com audiência `PUBLIC` ou `FRIENDS`, e pode gerenciar suas próprias publicações.
2. **Edição local antes de enviar**: histórico e estados de edição permanecem no dispositivo/navegador. Nenhum serviço deve persistir versões de edição como biblioteca.
3. **Armazenamento físico mínimo**: depois da publicação e reconciliação, manter somente o arquivo final ativo; staging deve expirar e ter limpeza.
4. **Não excluir arquivos sem migração segura**: considerar edição, exclusão, moderação, evidências legais, retries, GCS generations e componentes de vídeos. O propósito é remover redundância, não causar perda de dados.
5. **Uma publicação, múltiplas visões autorizadas**: proprietário e visitantes devem usar a mesma autoridade de publicação, respeitando a audiência e o backend. Não fazer a UI depender exclusivamente de `users/{uid}/photos`.
6. **Compatibilidade de código**: manter Observables, reatividade, métodos públicos, acessibilidade e tratamento centralizado de erros. Captura da câmera (foto e vídeo) segue os mesmos métodos de seleção, validação, editor local e publicação; nunca cria endpoint/cópia privada paralelos. O Mural suporta captura de fotos, não vídeo.
7. **Antes de considerar concluído**: verificar testes, Quality Gate, Media E2E, paginação, duplicação e viewer de `PUBLIC`/`FRIENDS`.

Se código legado contradisser essas diretrizes, documente a dívida e proponha migração coordenada. **Não interprete comentários antigos sobre “acervo privado” como autorização para manter ou expandir essa funcionalidade.**
