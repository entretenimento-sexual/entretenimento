#!/usr/bin/env node
// Analysis is local only. The export may contain sensitive raw metadata.
import { readFile, stat } from 'node:fs/promises';
import { summarizeExportedVideoSchedulerLogs } from './video-scheduler-log-audit.policy.mjs';

const file = process.argv[2];
if (process.argv.length !== 3 || !file || file.startsWith('-') ||
    !file.toLowerCase().endsWith('.json')) {
  console.error('Uso: node scripts/dev/inspect-video-scheduler-logs.mjs CAMINHO.json');
  process.exitCode = 1;
} else {
  try {
    const metadata = await stat(file);
    if (!metadata.isFile() || metadata.size > 8 * 1024 * 1024) {
      throw new Error('Arquivo inválido.');
    }
    const raw = (await readFile(file, 'utf8')).replace(/^\uFEFF/, '');
    const json = JSON.parse(raw);
    const entries = Array.isArray(json) ? json : json?.entries;
    const report = summarizeExportedVideoSchedulerLogs(entries);
    console.log('[video:scheduler-audit] Auditoria offline; campos privados omitidos.');
    console.log(JSON.stringify(report, null, 2));
    console.log('[video:scheduler-audit] A exportação não comprova disparos do Cloud Scheduler nem histórico completo.');
  } catch {
    console.error('[video:scheduler-audit] JSON inválido ou inacessível (limite 8 MiB e 2.000 entradas).');
    process.exitCode = 1;
  }
}
