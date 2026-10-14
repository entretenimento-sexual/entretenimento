// A deliberately narrow recovery boundary. Never stop Node, Java or ports in bulk.
import path from 'node:path';

function canonical(value) {
  return String(value ?? '').replace(/\\/g, '/').toLowerCase();
}

export function assessOrphanFirestore({
  owner, hubOccupied, otherPorts, projectRoot, projectId,
}) {
  if (hubOccupied) return 'Emulator Hub ainda ativo: não é um Firestore órfão.';
  if (otherPorts.length) return 'Outros serviços emulados ainda ativos: encerramento automático recusado.';
  if (!owner || owner.count !== 1 || !Number.isSafeInteger(owner.pid) || owner.pid < 1) {
    return 'A porta 8080 não possui exatamente um processo identificado.';
  }
  if (String(owner.name).toLowerCase() !== 'java.exe') return 'O processo não é java.exe.';
  if (owner.parentAlive !== false) return 'O processo pai ainda existe ou não pôde ser verificado.';

  const line = canonical(owner.commandLine);
  if (!line.includes('cloud-firestore-emulator-v') ||
      !/(?:^|\s)--port\s+8080(?:\s|$)/.test(line) ||
      !new RegExp('(?:^|\\s)--project_id\\s+' +
        String(projectId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').toLowerCase() +
        '(?:\\s|$)').test(line)) {
    return 'A linha de comando não corresponde ao Firestore Emulator deste projeto.';
  }
  const importFolder = canonical(path.join(projectRoot, '.emulator-data', 'firestore_export'));
  const rulesFile = canonical(path.join(projectRoot, 'firestore.rules'));
  if (!line.includes(importFolder) || !line.includes(rulesFile)) {
    return 'O processo não usa o snapshot e as Rules deste repositório.';
  }
  return null;
}
