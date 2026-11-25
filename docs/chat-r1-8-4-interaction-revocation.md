# CHAT-R1.8.4 — Contexto de interação e revogação entre módulos

Base homologada: `74adbc25928158ada9c548bc66ccae4d939b2906`. Quality Gate 45666691109: success; Angular 526 arquivos/3313 testes; Firestore Rules 48 arquivos/390 testes; reconciliação e E2E bilateral success. EST-R1.5/1.5.1 PASS.

## Contratos corrigidos
- Chat/Amizades/Discovery: cartão compartilhado mantém a disponibilidade derivada, invalida ação durante encerramento de amizade, vincula o modal ao UID de abertura. Resultado de modal não navega se sessão, alvo, disponibilidade ou componente foram revogados. A escuta adicional do dono é somente de Auth, não uma nova consulta ao Firestore.
- Modal: destinatário imutável no contexto de abertura; proprietário esperado conferido contra Auth; logout ou transição para outra sessão encerram definitivamente aquele observador, inclusive retorno ao mesmo UID. Gate e projeção podem recuperar no mesmo contexto de sessão.
- Perfil visitado/Media/Comunidades: perda da visibilidade pública, troca de rota ou sessão cancela confirmação e feedback pendente. A máscara otimista de bloqueio é descartada na troca de sessão ou quando o perfil se torna indisponível. Não inferir disponibilidade de Chat apenas da amizade: anúncio acessível acompanha projeção efetiva.
- Notificações/Comunidades: não introduzir autorização de envio em rotas ou referências; destino continua responsável pela leitura e autorização. Não houve alteração direta nesses módulos.
- Backend/Rules: nenhuma alteração de ACL, funções, quotas, política bilateral, histórico ou fonte canônica. Cancelar Observable não desfaz callable já despachada; servidor continua autoridade.

## Validação
Regressões adicionadas para sessão explícita, logout/mesmo UID, modal e contexto de cartão, recuperação e revogação de visibilidade do perfil e anúncio acessível. A compilação e a suíte integral do novo commit dependem da CI; não executadas localmente neste ambiente. Homologação de navegador real e carga multi-instância continuam pendentes. Escopo deliberadamente concentrado nos pontos de entrada compartilhados e não em refatoração geral.
