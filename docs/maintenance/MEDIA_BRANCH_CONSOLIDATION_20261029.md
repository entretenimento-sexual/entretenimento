# Consolidação de desenvolvimento Media — 29/10/2026

A `main` é a única linha de desenvolvimento. **Não criar branches, realizar merges ou abrir PRs.** Ver [AGENTS.md](../../AGENTS.md).

O estado funcional anteriormente testado no commit `91e9e3f2cf9808258bffd2b4a1330193e0a4efff` foi transplantado para a `main` por atualização direta de arquivos, sem criar uma segunda linha de desenvolvimento e sem merge de históricos. Abrange a cadeia de vídeo FRIENDS, galeria autorizada, edição/substituição de fotos, integridade do original legado, data canônica, auditoria não destrutiva, backfill somente emulador, câmera e ajustes de apresentação. O código foi objeto de Quality Gate e Media E2E bem-sucedidos na origem; somente o CI do novo commit da `main` constitui validação da integração.

Os branches antigos que divergiram antes desse estado têm diferenças exclusivas a avaliar separadamente; **não são fonte automática de reintrodução de código**. Em especial, a variante de captura de câmera, testes legados e o antigo destaque de primeira foto não devem substituir os fluxos já verificados sem análise.

Nenhuma migração ou exclusão de Storage/Firestore foi executada. A retirada física de originais legados continua proibida até auditoria, backfill de datas, verificação de moderação/retenção e revisão transacional por geração. A galeria de testes e os arquivos locais não rastreados devem ser preservados.

## Encerramento administrativo de branches/PRs

Os 16 PRs #218–#233 foram encerrados sem merge após o transporte do código consolidado para `main`. As referências remotas permanecem até remoção explícita: a operação não está disponível pelo conector GitHub atual. Para conferência sem alterações, use `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/dev/cleanup-obsolete-media-branches.ps1`; para remover as referências auditadas na máquina autenticada, acrescente `-Execute`. O script verifica `main`, o remote e os 16 SHAs previamente observados, recusa alterações inesperadas e não afeta dados Firebase nem arquivos locais. Não o execute sem revisar a lista; referências históricas específicas podem ser relevantes para auditoria.
