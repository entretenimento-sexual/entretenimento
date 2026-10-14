#!/usr/bin/env node
// Offline only; never invokes gcloud, Firebase, Cloud Scheduler or Transcoder.
import { readFile, stat } from 'node:fs/promises';
import {
  summarizeExportedCancellationLogs,
} from './video-cancellation-log-audit.policy.mjs';

const file = process.argv[2];
if (
  process.argv.length !== 3 || !file ||
  file.startsWith('-') || !file.toLowerCase().endsWith('.json')
) {
  console.error('Uso: node scripts/dev/inspect-video-cancellation-logs.mjs CAMINHO.json');
  process.exitCode = 1;
} else {
  try {
    const metadata = await stat(file);
    if (!metadata.isFile() || metadata.size > 8 * 1024 * 1024) {
      throw new Error('Arquivo inválido.');
    }
    const text = (await readFile(file, 'utf8')).replace(/^\uFEFF/, '');
    const json = JSON.parse(text);
    const entries = Array.isArray(json) ? json : json?.entries;
    const result = summarizeExportedCancellationLogs(entries);
    console.log('[video:scheduler-audit] Somente leitura; resumo sem IDs.');
    console.log(JSON.stringify(result, null, 2));
    console.log(
      '[video:scheduler-audit] Logs ausentes ou ciclos incompletos não ' +
      'comprovam falha: podem refletir retenção, filtro ou exportação parcial.'
    );
  } catch {
    console.error(
      '[video:scheduler-audit] JSON inválido ou inacessível (limite 8 MiB).'
    );
    process.exitCode = 1;
  }
}
