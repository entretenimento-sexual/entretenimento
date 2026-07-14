// scripts/tests/run-video-publication-e2e.mjs
// -----------------------------------------------------------------------------
// Executa os E2Es de video com variaveis restritas ao processo dos emuladores.
// Resolve automaticamente JDK 21+ e Node 22 sem alterar o ambiente global.
// -----------------------------------------------------------------------------

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PROJECT_ID = 'demo-entretenimento-media-e2e';
const STORAGE_BUCKET = `${PROJECT_ID}.appspot.com`;
const MINIMUM_JAVA_MAJOR = 21;
const REQUIRED_NODE_MAJOR = 22;
const FUNCTIONS_DISCOVERY_TIMEOUT_SECONDS = 60;
const firebaseCli = path.resolve(
  'node_modules',
  'firebase-tools',
  'lib',
  'bin',
  'firebase.js'
);
const testCommand = [
  'node scripts/tests/video-publication.e2e.mjs',
  'node scripts/tests/video-social.e2e.mjs',
  'node scripts/tests/video-ratings.e2e.mjs',
  'node scripts/tests/video-reports.e2e.mjs',
].join(' && ');

function pathEnvironmentKey(environment) {
  return (
    Object.keys(environment).find((key) => key.toLowerCase() === 'path') ??
    'PATH'
  );
}

function prependExecutableDirectory(environment, executablePath) {
  const pathKey = pathEnvironmentKey(environment);
  const currentPath = environment[pathKey] ?? '';
  const executableDirectory = path.dirname(executablePath);

  return {
    ...environment,
    [pathKey]: `${executableDirectory}${path.delimiter}${currentPath}`,
  };
}

function parseJavaMajor(versionOutput) {
  const match = String(versionOutput).match(/version\s+"(?:1\.)?(\d+)/i);
  return match ? Number.parseInt(match[1], 10) : null;
}

function readJavaMajor(javaExecutable) {
  const result = spawnSync(javaExecutable, ['-version'], {
    encoding: 'utf8',
    windowsHide: true,
  });

  if (result.error || result.status !== 0) {
    return null;
  }

  return parseJavaMajor(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
}

function javaExecutableForHome(javaHome) {
  return path.join(
    javaHome,
    'bin',
    process.platform === 'win32' ? 'java.exe' : 'java'
  );
}

function addJavaHomesFromDirectory(candidateHomes, directoryPath) {
  if (!directoryPath || !fs.existsSync(directoryPath)) {
    return;
  }

  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const candidateHome = path.join(directoryPath, entry.name);
    const candidateJava = javaExecutableForHome(candidateHome);

    if (fs.existsSync(candidateJava)) {
      candidateHomes.add(candidateHome);
    }
  }
}

function collectJavaHomeCandidates() {
  const candidateHomes = new Set();

  if (process.env.JAVA_HOME) {
    candidateHomes.add(process.env.JAVA_HOME);
  }

  if (process.platform === 'win32') {
    const userProfile = process.env.USERPROFILE ?? os.homedir();
    const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';

    addJavaHomesFromDirectory(
      candidateHomes,
      path.join(userProfile, '.jdks', 'temurin-21')
    );
    addJavaHomesFromDirectory(
      candidateHomes,
      path.join(programFiles, 'Eclipse Adoptium')
    );
    addJavaHomesFromDirectory(
      candidateHomes,
      path.join(programFiles, 'Java')
    );
    addJavaHomesFromDirectory(
      candidateHomes,
      path.join(programFiles, 'Microsoft')
    );
  } else {
    addJavaHomesFromDirectory(candidateHomes, '/usr/lib/jvm');
    addJavaHomesFromDirectory(candidateHomes, '/Library/Java/JavaVirtualMachines');
  }

  return [...candidateHomes];
}

function resolveJavaEnvironment(baseEnvironment) {
  const currentJavaMajor = readJavaMajor('java');

  if (currentJavaMajor !== null && currentJavaMajor >= MINIMUM_JAVA_MAJOR) {
    console.log(`[video:e2e] Java ${currentJavaMajor} encontrado no PATH.`);
    return { ...baseEnvironment };
  }

  for (const javaHome of collectJavaHomeCandidates()) {
    const javaExecutable = javaExecutableForHome(javaHome);
    const javaMajor = readJavaMajor(javaExecutable);

    if (javaMajor === null || javaMajor < MINIMUM_JAVA_MAJOR) {
      continue;
    }

    console.log(`[video:e2e] JDK ${javaMajor} selecionado: ${javaHome}`);

    return {
      ...prependExecutableDirectory(baseEnvironment, javaExecutable),
      JAVA_HOME: javaHome,
    };
  }

  console.error(
    '[video:e2e] JDK 21 ou superior nao encontrado. ' +
      'Instale um JDK compativel ou defina JAVA_HOME antes de executar o E2E.'
  );
  process.exit(1);
}

function readNodeMajor(nodeExecutable) {
  const result = spawnSync(
    nodeExecutable,
    ['-p', 'process.versions.node.split(".")[0]'],
    {
      encoding: 'utf8',
      windowsHide: true,
    }
  );

  if (result.error || result.status !== 0) {
    return null;
  }

  const major = Number.parseInt(String(result.stdout ?? '').trim(), 10);
  return Number.isFinite(major) ? major : null;
}

function addNodeExecutablesFromDirectory(candidateExecutables, directoryPath) {
  if (!directoryPath || !fs.existsSync(directoryPath)) {
    return;
  }

  const executableName = process.platform === 'win32' ? 'node.exe' : 'node';
  const directExecutable = path.join(directoryPath, executableName);

  if (fs.existsSync(directExecutable)) {
    candidateExecutables.add(directExecutable);
  }

  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const candidateExecutable = path.join(
      directoryPath,
      entry.name,
      executableName
    );

    if (fs.existsSync(candidateExecutable)) {
      candidateExecutables.add(candidateExecutable);
    }
  }
}

function collectNodeExecutableCandidates() {
  const candidates = new Set([process.execPath]);

  if (process.env.NODE_HOME) {
    addNodeExecutablesFromDirectory(candidates, process.env.NODE_HOME);
  }

  if (process.platform === 'win32') {
    const userProfile = process.env.USERPROFILE ?? os.homedir();
    const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';

    addNodeExecutablesFromDirectory(
      candidates,
      path.join(userProfile, '.nodes', 'node-22')
    );
    addNodeExecutablesFromDirectory(candidates, path.join(programFiles, 'nodejs'));
  } else {
    addNodeExecutablesFromDirectory(candidates, '/usr/local/bin');
    addNodeExecutablesFromDirectory(candidates, '/usr/bin');
  }

  return [...candidates];
}

function resolveNodeRuntime(baseEnvironment) {
  for (const nodeExecutable of collectNodeExecutableCandidates()) {
    const nodeMajor = readNodeMajor(nodeExecutable);

    if (nodeMajor !== REQUIRED_NODE_MAJOR) {
      continue;
    }

    console.log(`[video:e2e] Node ${nodeMajor} selecionado: ${nodeExecutable}`);

    return {
      executable: nodeExecutable,
      environment: {
        ...prependExecutableDirectory(baseEnvironment, nodeExecutable),
        NODE_HOME: path.dirname(nodeExecutable),
      },
    };
  }

  console.error(
    '[video:e2e] Node 22 nao encontrado. ' +
      'Instale o runtime compativel ou disponibilize-o em ' +
      '%USERPROFILE%\\.nodes\\node-22.'
  );
  process.exit(1);
}

const javaEnvironment = resolveJavaEnvironment(process.env);
const nodeRuntime = resolveNodeRuntime(javaEnvironment);
const emulatorEnvironment = {
  ...nodeRuntime.environment,
  FUNCTIONS_DISCOVERY_TIMEOUT: String(FUNCTIONS_DISCOVERY_TIMEOUT_SECONDS),
  MEDIA_AUTO_APPROVE_VIDEOS: 'true',
  MEDIA_EMULATOR_AUTO_PROCESS_VIDEOS: 'false',
  FIREBASE_STORAGE_BUCKET: STORAGE_BUCKET,
};

console.log(
  `[video:e2e] Timeout de descoberta das Functions: ` +
    `${FUNCTIONS_DISCOVERY_TIMEOUT_SECONDS}s.`
);
console.log(
  '[video:e2e] Processamento automatico local desativado para validar ' +
    'explicitamente a fila e a conclusao simulada do provedor.'
);

const child = spawn(
  nodeRuntime.executable,
  [
    firebaseCli,
    'emulators:exec',
    '--config',
    'firebase.media-e2e.json',
    '--only',
    'auth,firestore,storage,functions',
    '--project',
    PROJECT_ID,
    testCommand,
  ],
  {
    cwd: process.cwd(),
    env: emulatorEnvironment,
    stdio: 'inherit',
  }
);

child.on('error', (error) => {
  console.error('Nao foi possivel iniciar o E2E de video.', error);
  process.exitCode = 1;
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`E2E de video interrompido por ${signal}.`);
    process.exitCode = 1;
    return;
  }

  process.exitCode = code ?? 1;
});
