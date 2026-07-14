// scripts/tests/run-video-publication-e2e.mjs
// -----------------------------------------------------------------------------
// Executa os E2Es de video com variaveis restritas ao processo dos emuladores.
// Resolve automaticamente um JDK 21+ sem alterar o ambiente global da maquina.
// -----------------------------------------------------------------------------

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PROJECT_ID = 'demo-entretenimento-media-e2e';
const STORAGE_BUCKET = `${PROJECT_ID}.appspot.com`;
const MINIMUM_JAVA_MAJOR = 21;
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

function resolveJavaEnvironment() {
  const currentJavaMajor = readJavaMajor('java');

  if (currentJavaMajor !== null && currentJavaMajor >= MINIMUM_JAVA_MAJOR) {
    console.log(`[video:e2e] Java ${currentJavaMajor} encontrado no PATH.`);
    return { ...process.env };
  }

  for (const javaHome of collectJavaHomeCandidates()) {
    const javaExecutable = javaExecutableForHome(javaHome);
    const javaMajor = readJavaMajor(javaExecutable);

    if (javaMajor === null || javaMajor < MINIMUM_JAVA_MAJOR) {
      continue;
    }

    const pathKey = Object.keys(process.env).find(
      (key) => key.toLowerCase() === 'path'
    ) ?? 'PATH';
    const currentPath = process.env[pathKey] ?? '';

    console.log(`[video:e2e] JDK ${javaMajor} selecionado: ${javaHome}`);

    return {
      ...process.env,
      JAVA_HOME: javaHome,
      [pathKey]: `${path.join(javaHome, 'bin')}${path.delimiter}${currentPath}`,
    };
  }

  console.error(
    '[video:e2e] JDK 21 ou superior nao encontrado. ' +
    'Instale um JDK compativel ou defina JAVA_HOME antes de executar o E2E.'
  );
  process.exit(1);
}

const child = spawn(
  process.execPath,
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
    env: {
      ...resolveJavaEnvironment(),
      MEDIA_AUTO_APPROVE_VIDEOS: 'true',
      FIREBASE_STORAGE_BUCKET: STORAGE_BUCKET,
    },
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
