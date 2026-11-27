# UX-R1.0B — inbox progressiva e compatibilidade de navegadores

- Estado vazio mínimo opt-in pelo componente canônico ContentState. Erro, ação, loading e estados de segurança mantêm suas apresentações.
- Paginação ao aproximar-se do fim de uma lista rolável (96px), uma solicitação por extensão até afastamento ou mudança de altura. Não dispara busca automática de páginas sem rolagem nem varre resultados de busca parcial. Controle manual acessível permanece.
- Atualização manual deixa de aparecer em estado saudável. Retry contextual reconstrói o stream sem alterar seleção ou compositor. O estado de acesso não confirmado preserva recuperação explícita.
- Preservados limite de página, autorização, cursor, invalidação e políticas de retry das camadas inferiores.
- Matriz: Chromium 3 réplicas, Chrome e Edge canais reais, Firefox e WebKit Playwright, em Linux. Todos executam os cenários integrados; métricas CDP somente em motores Chromium. Artefato browser-version.json registra versão e capacidades. Não equivale a certificação Safari nativo ou Firefox comercial; Safari em macOS/iOS e codecs ficam pendentes.
- Nenhum resultado é presumido antes da conclusão de cada job e verificação dos artefatos. 

## UX-R1.0B.1 — evidências da primeira matriz

- Firefox: as 18 fases iniciais passaram, incluindo 181 mensagens recuperadas. O ZIP demonstrou leituras HTTP 200 nas duas direções dos dois documentos Friends, numerados 3 em vez de 2. O runner agora captura os documentos realmente montados e mantém a exigência de respostas 200 por direção e identidade.
- WebKit: 18 fases passaram, porém 31 eventos pageerror de acesso a recursos locais impediram certificação. A hipótese de diagnóstico do transporte não equivale a prova de erro do runner. Nova instrumentação distingue ErrorEvent/unhandledrejection nativos e correlaciona URLs exatas de requisições falhas apenas em memória; evidência persistida não contém query strings. Nenhuma exceção é ignorada; ambos os gates permanecem estritos.
- Branch de correção separada para não cancelar os cinco jobs restantes da matriz original.
