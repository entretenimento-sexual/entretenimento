// Read-only fail-closed validation before importing persisted Firebase Emulator data.
import fs from 'node:fs';
import path from 'node:path';

const SERVICES = new Set(['auth', 'firestore', 'storage']);
const isDir = p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const isFile = p => { try { return fs.statSync(p).isFile(); } catch { return false; } };

function resolveWithin(root, entry, label) {
  if (typeof entry !== 'string' || !entry || path.isAbsolute(entry)) {
    throw new Error(label + ': caminho relativo obrigatório.');
  }
  const full = path.resolve(root, entry);
  const rel = path.relative(root, full);
  if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) {
    throw new Error(label + ': caminho fora do diretório de exportação.');
  }
  if (fs.existsSync(full)) {
    const actualRoot = fs.realpathSync(root);
    const actual = fs.realpathSync(full);
    const actualRel = path.relative(actualRoot, actual);
    if (!actualRel || actualRel === '..' || actualRel.startsWith('..' + path.sep) || path.isAbsolute(actualRel)) {
      throw new Error(label + ': link para fora do diretório de exportação.');
    }
  }
  return full;
}

export function validateEmulatorSnapshotImport(dataPath, requestedEmulators) {
  if (!fs.existsSync(dataPath)) return false;
  if (!isDir(dataPath)) throw new Error('Diretório de dados inválido.');
  const manifestPath = path.join(dataPath, 'firebase-export-metadata.json');
  if (!isFile(manifestPath)) {
    if (fs.readdirSync(dataPath).length) {
      throw new Error('Diretório não vazio sem firebase-export-metadata.json: importação bloqueada.');
    }
    return false;
  }

  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
  catch { throw new Error('firebase-export-metadata.json contém JSON inválido.'); }
  if (!manifest || Array.isArray(manifest) || typeof manifest !== 'object') {
    throw new Error('firebase-export-metadata.json deve conter um objeto.');
  }

  const requested = new Set(requestedEmulators);
  for (const service of SERVICES) {
    const entry = manifest[service];
    if (!entry) {
      if (requested.has(service)) throw new Error('Snapshot não contém exportação de ' + service + ' solicitada.');
      continue;
    }
    if (Array.isArray(entry) || typeof entry !== 'object') {
      throw new Error('Manifesto inválido para ' + service + '.');
    }
    const dir = resolveWithin(dataPath, entry.path, service + '.path');
    if (!isDir(dir)) throw new Error('Diretório ausente da exportação ' + service + ': ' + entry.path);

    if (service === 'firestore') {
      const metadata = resolveWithin(dataPath, entry.metadata_file, 'firestore.metadata_file');
      if (!isFile(metadata) || fs.statSync(metadata).size === 0) {
        throw new Error('firestore.metadata_file ausente ou vazio.');
      }
      const withinFirestore = path.relative(dir, metadata);
      if (withinFirestore === '..' || withinFirestore.startsWith('..' + path.sep)) {
        throw new Error('firestore.metadata_file fora de firestore_export.');
      }
    }
    if (service === 'auth' && !isFile(path.join(dir, 'accounts.json'))) {
      throw new Error('Exportação Authentication sem accounts.json.');
    }
  }
  return true;
}
