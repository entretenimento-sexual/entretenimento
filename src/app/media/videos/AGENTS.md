# Diretrizes para vídeo e captura por câmera

Antes de modificar qualquer fluxo de vídeo, gravação, upload, editor, publicação,
Storage, limpeza ou viewer, leia a regra canônica de mídia social em
[../photos/DIRETRIZES-MIDIAS-PUBLICADAS.md](../photos/DIRETRIZES-MIDIAS-PUBLICADAS.md).

**Regras obrigatórias:**

- **Não criar drive/galeria privada**, rascunho permanente nem versões físicas históricas.
- O vídeo gravado diretamente pela câmera do dispositivo segue o **mesmo**
  `ProfileVideosComponent.onVideoSelected()` usado pelo seletor de arquivos.
  Gravar **não** é publicar; o usuário escolhe e confirma o envio explicitamente.
- Edição opcional no navegador; staging temporário com expiração e limpeza após publicação.
- Uma mídia final ativa depois da publicação e da limpeza operacional.
- O backend de vídeos atualmente publica em `PUBLIC`; o contrato também prevê `FRIENDS`,
  mas não ofereça essa audiência na UI sem verificar e implementar toda a cadeia
  de autorização, viewer, URLs e persistência. Nunca introduzir `ONLY_ME`.
- Falhas de formato/códec, gravação, upload, moderação e limpeza usam os limites
  centralizados de erro; observables, acessibilidade e nomes públicos existentes
  devem ser preservados.
- Não apagar cópias legadas até migrar transações, processamento, moderação,
  obrigações de retenção legal, exclusão segura por geração GCS e tarefas de retry.
- O composer comunitário de câmera atualmente suporta **foto**, não vídeo.
  Não contorne o contrato atual enviando vídeo pelo fluxo de anexo de imagem.

Verifique testes de editor, publicação, retenção, regras e Media E2E antes de integrar.
