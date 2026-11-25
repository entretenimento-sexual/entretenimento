# CHAT-R1.10.2 — Primeira etapa de certificação operacional em Chromium

Base 2488954492e26c1d5d5441b8d08a4a1b5260ab5e: Quality Gate 45712760091 e aggregate success; todos os passos obrigatórios aprovados.

## Escopo executável

Novo workflow independente Chat Integrated Browser Certification. Angular real em dev-emu, Chromium headless, três contas sintéticas (dois contextos de navegador independentes, A→C→A no primeiro). Projeto demo descartável e endpoints loopback, sem importação de snapshots, sem acesso a produção, tráfego externo do browser bloqueado. O checkout efêmero recebe a configuração de emuladores; nenhum arquivo de ambiente canônico é alterado no repositório.

Teste: login pela UI, notificação fixture lida pela UI e callable real de leitura, deep link, envio e recepção de texto nos dois sentidos, bloqueio e desbloqueio por callable real em SDK autenticado de B enquanto ambas as UIs permanecem abertas, limpeza de draft e histórico autorizado recuperado, logout A→C→A, isolamento da conta C e independência B, dimensões mobile e nome acessível. Evidência de fases, screenshots e diagnóstico do console; ausência de pageerror obrigatória. A fixture de compliance e amizade é Admin, não teste da produção dessas entidades. RTDB do runner explicitamente deny-all; presença/RTDB não certificadas nesta etapa.

## Limites

Não é homologação integral: o workflow ainda precisa executar e ser corrigido até passar. Não foi executado localmente nesta sessão. Não certifica todos os pontos de entrada de Discovery, Perfil, Amizades, Media ou Comunidades nem notificações produzidas por esses módulos no browser. O Quality Gate canônico continua obrigatório, mas este workflow ainda é independente; sua integração ao agregado depende de evidência de estabilidade. Nenhuma alteração em código de produção, ACL, rate limits ou deploy. Etapas seguintes: ampliar cenários reais de módulos e acessibilidade, validar recuperação de listeners e integrar resultado obrigatório ao gate.
