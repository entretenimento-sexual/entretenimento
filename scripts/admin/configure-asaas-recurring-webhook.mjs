// scripts/admin/configure-asaas-recurring-webhook.mjs
// -----------------------------------------------------------------------------
// Configura/atualiza o webhook de cobrança recorrente no Asaas.
// DRY-RUN por padrão. --apply é obrigatório para escrita externa.
// Segredos são lidos do ambiente e nunca impressos.
// -----------------------------------------------------------------------------

const DEFAULT_NAME = 'Entretenimento Recurring Billing';

const EVENTS = Object.freeze([
  'CHECKOUT_CREATED',
  'CHECKOUT_PAID',
  'CHECKOUT_CANCELED',
  'CHECKOUT_EXPIRED',
  'SUBSCRIPTION_CREATED',
  'SUBSCRIPTION_UPDATED',
  'SUBSCRIPTION_INACTIVATED',
  'SUBSCRIPTION_DELETED',
  'PAYMENT_CONFIRMED',
  'PAYMENT_RECEIVED',
  'PAYMENT_OVERDUE',
  'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED',
  'PAYMENT_REPROVED_BY_RISK_ANALYSIS',
  'PAYMENT_CREDIT_CARD_THREE_D_SECURE_CHALLENGE_FAILED',
  'PAYMENT_REFUNDED',
  'PAYMENT_PARTIALLY_REFUNDED',
  'PAYMENT_RECEIVED_IN_CASH_UNDONE',
  'PAYMENT_CHARGEBACK_REQUESTED',
  'PAYMENT_CHARGEBACK_DISPUTE',
  'PAYMENT_AWAITING_CHARGEBACK_REVERSAL',
]);

function parseArgs(argv) {
  const result = {
    environment: '',
    url: '',
    email: '',
    name: DEFAULT_NAME,
    apply: false,
  };

  for (const arg of argv) {
    if (arg.startsWith('--environment=')) {
      result.environment = arg.slice('--environment='.length).trim().toLowerCase();
    } else if (arg.startsWith('--url=')) {
      result.url = arg.slice('--url='.length).trim();
    } else if (arg.startsWith('--email=')) {
      result.email = arg.slice('--email='.length).trim();
    } else if (arg.startsWith('--name=')) {
      result.name = arg.slice('--name='.length).trim();
    } else if (arg === '--apply') {
      result.apply = true;
    } else {
      throw new Error('Argumento desconhecido: ' + arg);
    }
  }

  return result;
}

function requireEnvironment(value) {
  if (value !== 'sandbox' && value !== 'production') {
    throw new Error('--environment deve ser sandbox ou production.');
  }
  return value;
}

function requireHttpsUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('--url precisa ser uma URL HTTPS pública válida.');
  }

  if (url.protocol !== 'https:' || !url.hostname) {
    throw new Error('--url precisa ser uma URL HTTPS pública válida.');
  }

  return url.toString();
}

function requireEmail(value) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    throw new Error('--email precisa ser um endereço válido.');
  }
  return value;
}

function requireApiKey(value, environment) {
  const key = String(value ?? '').trim();
  const prefix = environment === 'production' ? '$aact_prod_' : '$aact_hmlg_';

  if (!key.startsWith(prefix)) {
    throw new Error(
      'ASAAS_API_KEY não corresponde ao ambiente selecionado.'
    );
  }

  return key;
}

function requireWebhookToken(value) {
  const token = String(value ?? '').trim();

  if (
    token.length < 32 ||
    token.length > 255 ||
    /\s/.test(token) ||
    token.startsWith('$aact_')
  ) {
    throw new Error(
      'ASAAS_WEBHOOK_TOKEN deve ter 32–255 caracteres, sem espaços, e ser distinto da API key.'
    );
  }

  return token;
}

function apiBaseUrl(environment) {
  return environment === 'production'
    ? 'https://api.asaas.com/v3'
    : 'https://api-sandbox.asaas.com/v3';
}

function desiredPayload(args, webhookToken) {
  return {
    name: args.name,
    url: args.url,
    email: args.email,
    enabled: true,
    interrupted: false,
    apiVersion: 3,
    authToken: webhookToken,
    sendType: 'SEQUENTIALLY',
    events: [...EVENTS],
  };
}

function sanitizeForDisplay(payload) {
  return {
    ...payload,
    authToken: '<secret>',
  };
}

async function request(baseUrl, apiKey, path, init = {}) {
  const response = await fetch(baseUrl + path, {
    ...init,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      access_token: apiKey,
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = {};
    }
  }

  if (!response.ok) {
    const message = Array.isArray(payload?.errors)
      ? payload.errors
          .map((entry) => String(entry?.description ?? entry?.code ?? 'erro'))
          .join('; ')
      : 'HTTP ' + response.status;
    throw new Error('Asaas rejeitou a operação: ' + message);
  }

  return payload;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

function matchesWebhook(candidate, args) {
  return String(candidate?.name ?? '') === args.name
    || String(candidate?.url ?? '') === args.url;
}

const args = parseArgs(process.argv.slice(2));
args.environment = requireEnvironment(args.environment);
args.url = requireHttpsUrl(args.url);
args.email = requireEmail(args.email);

if (!args.name || args.name.length > 120) {
  throw new Error('--name precisa ter entre 1 e 120 caracteres.');
}

const apiKey = requireApiKey(
  process.env.ASAAS_API_KEY,
  args.environment
);
const webhookToken = requireWebhookToken(
  process.env.ASAAS_WEBHOOK_TOKEN
);
const baseUrl = apiBaseUrl(args.environment);
const desired = desiredPayload(args, webhookToken);

console.log(
  args.apply
    ? '[asaas-recurring-webhook] APPLY'
    : '[asaas-recurring-webhook] DRY-RUN'
);
console.log(JSON.stringify(sanitizeForDisplay(desired), null, 2));

if (!args.apply) {
  console.log(
    '\nNenhuma alteração externa foi feita. Use --apply após conferir ambiente, URL e eventos.'
  );
  process.exit(0);
}

const existingResponse = await request(
  baseUrl,
  apiKey,
  '/webhooks?limit=100'
);
const matches = asArray(existingResponse).filter((entry) =>
  matchesWebhook(entry, args)
);

if (matches.length > 1) {
  throw new Error(
    'Há mais de um webhook correspondente por nome/URL. Resolva a duplicidade antes de aplicar.'
  );
}

if (matches.length === 0) {
  const created = await request(
    baseUrl,
    apiKey,
    '/webhooks',
    {
      method: 'POST',
      body: JSON.stringify(desired),
    }
  );

  console.log(
    '[ok] webhook criado: ' + String(created?.id ?? '<id-indisponível>')
  );
  process.exit(0);
}

const id = String(matches[0]?.id ?? '').trim();
if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) {
  throw new Error('Webhook existente retornou identificador inválido.');
}

await request(
  baseUrl,
  apiKey,
  '/webhooks/' + encodeURIComponent(id),
  {
    method: 'PUT',
    body: JSON.stringify(desired),
  }
);

console.log('[ok] webhook atualizado: ' + id);
