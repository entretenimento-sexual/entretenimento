//src\app\core\services\geolocation\geolocation.md
Geolocalização — Diretrizes de UX e Implementação (plataforma adulta)
Objetivo

Permitir experiências baseadas em localização sem incomodar o usuário, respeitando privacidade e políticas do navegador.

Princípios

Progressive disclosure: só pedir localização quando o usuário clicar em algo que realmente precisa (ex.: Perfis próximos).

Gesto do usuário: gateie o pedido atrás de um CTA (“Ativar localização”) para evitar avisos e rejeições automáticas.

Privacidade por padrão: sem e-mail verificado → usar coordenadas coarse (cidade/bairro) e geohash truncado.

Cache com TTL: reaproveitar a última posição (ex.: 5–30 min) para carregar a UI rápido, e atualizar em background.

Sem loops de prompt: se negou, não insistir; mostrar instrução para habilitar no navegador + fallback manual.

Contexto seguro: funcionar apenas em HTTPS (ou localhost).

Estados de permissão & UX
Estado (Permissions API)	O que fazer	UI sugerida
granted	Buscar posição silenciosamente	Sem modal; só loading discreto
prompt	Não chamar GPS automaticamente. Exibir CTA “Ativar localização”.	Card leve com botão
denied ou API indisponível	Não pedir de novo. Mostrar passo a passo para habilitar + fallback manual (cidade/bairro)	Card de ajuda

Safari iOS: permissions.query pode ser indisponível → sempre use CTA (gesto).

Regras por verificação de e-mail
Sem e-mail verificado (modo limitado)

Quando solicitar: apenas após clique em Perfis próximos, Mostrar distância, Explorar por região.

Precisão: usar coarse (arredondar lat/lon) e geohash curto.

Alternativa: seleção manual de região (sem GPS).

Com e-mail verificado

Permitir precisão exata (somente após CTA).

Exibir distância e ordenar por proximidade.

Watchers contínuos só se necessário (e com unsubscribe limpo).

Paywall de precisão por “role”

(alinhar com o GeolocationService.getPolicyFor)

Role	geohashLen	maxDistanceKm	decimals
vip	9	100	5
premium	8	50	4
basic	7	20	3
free	5	10	2

Se e-mail não verificado, aplique limites máximos: geohashLen ≤ 5, maxDistanceKm ≤ 20, decimals ≤ 2.

Fluxo recomendado (simples)

Pré-cheques

HTTPS/localhost e navigator.geolocation disponível.

Permissions API (quando existir)

granted → buscar silencioso.

prompt → mostrar CTA (não chamar GPS ainda).

denied/indisponível → card de ajuda + fallback manual/IP.

Clique no CTA

Chamar getCurrentPosition com { enableHighAccuracy: false, timeout: 10_000, maximumAge: 0 }.

Sucesso → aplicar applyRolePrivacy (arredondar + geohash).

Erro → mapear e mostrar mensagem amigável (sem insistir).

Pós-sucesso

Cachear {coords, geohash, ts} (IndexedDB/localStorage) com TTL.

Atualizar UI; se precisar de updates, iniciar watchPosition e limpar no unsubscribe.

Arranque da app

Se existe cache válido, usar imediatamente.

Em paralelo, se granted → refresh silencioso; se prompt → manter CTA; se denied → manter ajuda/fallback.

Mudanças de permissão

Se suportado, observar permissions.query(...).onchange.

Ao virar granted → buscar silencioso; ao virar denied → parar watchers e mostrar ajuda.

Cópias/CTAs (exemplos rápidos)

Card (prompt): “Para mostrar perfis perto de você, ative sua localização.”
Botão: Ativar localização

Ajuda (denied): “No Chrome, clique no cadeado → Local → Permitir. Depois clique em Tentar novamente.”
Link secundário: Escolher cidade manualmente

Fallbacks

Manual: autocomplete de cidade/bairro + país/estado.

IP (coarse): ~10–50 km (quando disponível).

Última posição válida: enquanto o usuário decide.

Mensagens de erro (mapa curto)

PERMISSION_DENIED: “Permissão negada. Você pode permitir no cadeado do navegador.”

POSITION_UNAVAILABLE: “Não foi possível obter sua posição agora. Tente novamente.”

TIMEOUT: “A tentativa expirou. Tentar novamente?”

UNKNOWN: “Ocorreu um erro. Você pode selecionar a cidade manualmente.”

Checklist de implementação

 HTTPS/localhost garantido.

 CTA único com gesto do usuário (guardar geo:askedOnce com TTL).

 Cache de posição com TTL (5–30 min) e refresh silencioso quando granted.

 Fallback manual/IP prontos.

 Aplicar applyRolePrivacy (role + verificação) antes de exibir/distanciar.

 Limpeza de watchPosition no unsubscribe.

 Ajuda por navegador (cadeado → Local → Permitir).
