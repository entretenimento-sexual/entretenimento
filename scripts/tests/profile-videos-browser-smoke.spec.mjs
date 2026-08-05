import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';

import { expect, test } from '@playwright/test';
import {
  deleteApp,
  initializeApp,
} from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const PROJECT_ID = 'entretenimento-sexual';
const STORAGE_BUCKET = `${PROJECT_ID}.appspot.com`;
const ARTIFACT_ROOT = 'artifacts/profile-videos-browser-smoke/screenshots';
const CURRENT_TERMS_VERSION = 'v3';
const CURRENT_LEGAL_DOCUMENT_VERSION = '2026-07-29.1';
const USER_BOOTSTRAP_TIMEOUT_MS = 15_000;

let adminApp;
let adminAuth;
let adminDb;
let bucket;
let ownerUid = '';
let email = '';
let password = '';
let videoId = '';
let sourcePath = '';
let processedPath = '';
let posterPath = '';

function normalizeStorageEmulatorEnvironment() {
  const configured = String(
    process.env.STORAGE_EMULATOR_HOST ??
      process.env.FIREBASE_STORAGE_EMULATOR_HOST ??
      '127.0.0.1:9199'
  ).trim();

  process.env.STORAGE_EMULATOR_HOST = /^https?:\/\//i.test(configured)
    ? configured
    : `http://${configured}`;
}

function assertSafeEmulatorEnvironment() {
  const authHost = String(process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '');
  const firestoreHost = String(process.env.FIRESTORE_EMULATOR_HOST ?? '');
  const storageHost = String(process.env.STORAGE_EMULATOR_HOST ?? '');

  expect(authHost).toBe('127.0.0.1:9099');
  expect(firestoreHost).toBe('127.0.0.1:8080');
  expect(storageHost).toBe('http://127.0.0.1:9199');
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForUserBootstrap() {
  const userRef = adminDb.doc(`users/${ownerUid}`);
  const deadline = Date.now() + USER_BOOTSTRAP_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const snapshot = await userRef.get();

    if (snapshot.exists) {
      // Garante que o trigger de criação encerrou antes da fixture sobrescrever
      // somente os campos necessários ao fluxo autenticado do smoke.
      await delay(250);
      return;
    }

    await delay(100);
  }

  throw new Error(
    `[profile-videos:browser-smoke] Perfil inicial não criado para ${ownerUid}.`
  );
}

async function removeStoragePrefix(prefix) {
  const [files] = await bucket.getFiles({ prefix });
  await Promise.all(
    files.map((file) => file.delete({ ignoreNotFound: true }))
  );
}

async function seedBrowserSmokeUser() {
  normalizeStorageEmulatorEnvironment();
  assertSafeEmulatorEnvironment();

  const runId = randomUUID().replace(/-/g, '');
  ownerUid = `profile-videos-smoke-${runId}`;
  email = `profile-videos-smoke-${runId}@example.test`;
  password = `Smoke-${runId}-Aa1!`;
  videoId = `video-${runId}`;
  sourcePath = `users/${ownerUid}/uploads/videos/${videoId}-source.mp4`;
  processedPath =
    `users/${ownerUid}/processed/videos/${videoId}/smoke-v1/playback.mp4`;
  posterPath =
    `users/${ownerUid}/uploads/video-posters/${videoId}/poster.png`;

  adminApp = initializeApp(
    {
      projectId: PROJECT_ID,
      storageBucket: STORAGE_BUCKET,
    },
    `profile-videos-browser-smoke-${runId}`
  );
  adminAuth = getAuth(adminApp);
  adminDb = getFirestore(adminApp);
  bucket = getStorage(adminApp).bucket(STORAGE_BUCKET);

  await adminAuth.createUser({
    uid: ownerUid,
    email,
    password,
    emailVerified: true,
    displayName: 'Perfil Smoke Vídeos',
    disabled: false,
  });
  await waitForUserBootstrap();

  const now = Date.now();

  await adminDb.doc(`users/${ownerUid}`).set(
    {
      uid: ownerUid,
      email,
      emailVerified: true,
      nickname: 'Perfil Smoke Vídeos',
      displayName: 'Perfil Smoke Vídeos',
      profileCompleted: true,
      interactionBlocked: false,
      publicVisibility: 'visible',
      accountStatus: 'active',
      suspended: false,
      accountLocked: false,
      initialAdultConsentRequired: false,
      ageReverification: {
        status: 'VERIFIED',
        verifiedAt: now,
        updatedAt: now,
      },
      acceptedTerms: {
        accepted: true,
        date: now,
        acceptedAt: now,
        updatedAt: now,
        version: CURRENT_TERMS_VERSION,
        termsDocumentVersion: CURRENT_LEGAL_DOCUMENT_VERSION,
        privacyNoticeVersion: CURRENT_LEGAL_DOCUMENT_VERSION,
        acknowledgedPrivacyNotice: true,
        acceptanceContext: 'initial',
        previousVersion: null,
        source: 'web',
      },
      createdAt: now,
      updatedAt: now,
    },
    { merge: true }
  );

  const transparentPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64'
  );
  const sourceBytes = Buffer.from('profile-videos-browser-smoke-source');
  const processedBytes = Buffer.from('profile-videos-browser-smoke-processed');

  await Promise.all([
    bucket.file(sourcePath).save(sourceBytes, {
      resumable: false,
      metadata: {
        contentType: 'video/mp4',
        cacheControl: 'private, max-age=0, no-store, no-transform',
      },
    }),
    bucket.file(processedPath).save(processedBytes, {
      resumable: false,
      metadata: {
        contentType: 'video/mp4',
        cacheControl: 'private, max-age=0, no-store, no-transform',
      },
    }),
    bucket.file(posterPath).save(transparentPng, {
      resumable: false,
      metadata: {
        contentType: 'image/png',
        cacheControl: 'private, max-age=0, no-store, no-transform',
      },
    }),
  ]);

  await adminDb.doc(`users/${ownerUid}/videos/${videoId}`).set({
    path: sourcePath,
    fileName: 'apresentacao-smoke.mp4',
    mimeType: 'video/mp4',
    sizeBytes: processedBytes.byteLength,
    sourceMimeType: 'video/mp4',
    sourceSizeBytes: sourceBytes.byteLength,
    durationMs: 30_000,
    thumbnailPath: posterPath,
    playbackPath: processedPath,
    processedStoragePath: processedPath,
    processedMimeType: 'video/mp4',
    processedSizeBytes: processedBytes.byteLength,
    processingCompletedAt: now,
    status: 'ready',
    createdAt: now,
    updatedAt: now,
  });
}

async function cleanupBrowserSmokeUser() {
  if (!adminApp || !ownerUid) {
    return;
  }

  await Promise.allSettled([
    adminDb.doc(`users/${ownerUid}/videos/${videoId}`).delete(),
    adminDb.doc(`users/${ownerUid}`).delete(),
    adminDb.doc(`public_profiles/${ownerUid}`).delete(),
    removeStoragePrefix(`users/${ownerUid}/`),
    adminAuth.deleteUser(ownerUid),
  ]);

  await deleteApp(adminApp);
}

function collectPageErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function loginAndOpenLibrary(page) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' });

  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);

  const submit = page.locator('form button[type="submit"]');
  await expect(submit).toBeEnabled();
  await submit.click();

  await page.waitForURL(
    (url) => !url.pathname.startsWith('/login'),
    { timeout: 45_000 }
  );

  await page.goto(`/media/perfil/${ownerUid}/videos`, {
    waitUntil: 'domcontentloaded',
  });

  await expect(
    page.getByRole('heading', { name: 'Meus vídeos' })
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.profile-videos__card')).toHaveCount(1, {
    timeout: 60_000,
  });
  await expect(page.locator('.profile-videos__count')).toContainText('1');
}

function screenshotPath(testInfo, name) {
  const safeProject = testInfo.project.name.replace(/[^a-z0-9_-]+/gi, '-');
  return `${ARTIFACT_ROOT}/${safeProject}-${name}.png`;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  mkdirSync(ARTIFACT_ROOT, { recursive: true });
  await seedBrowserSmokeUser();
});

test.afterAll(async () => {
  await cleanupBrowserSmokeUser();
});

test('mantém grade responsiva sem overflow horizontal', async ({ page }, testInfo) => {
  const pageErrors = collectPageErrors(page);
  const viewports = [
    { name: 'mobile-390', width: 390, height: 844, columns: 1 },
    { name: 'tablet-768', width: 768, height: 1024, columns: 2 },
    { name: 'desktop-1024', width: 1024, height: 900, columns: 3 },
    { name: 'desktop-1440', width: 1440, height: 1000, columns: 4 },
  ];

  await page.setViewportSize(viewports[0]);
  await loginAndOpenLibrary(page);

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(200);

    const grid = page.locator('.profile-videos__grid');
    const renderedColumns = await grid.evaluate((element) =>
      getComputedStyle(element)
        .gridTemplateColumns
        .split(/\s+/)
        .filter(Boolean).length
    );
    const overflow = await page.evaluate(() =>
      Math.max(
        0,
        document.documentElement.scrollWidth -
          document.documentElement.clientWidth
      )
    );

    expect(renderedColumns).toBe(viewport.columns);
    expect(overflow).toBeLessThanOrEqual(1);

    await page.screenshot({
      path: screenshotPath(testInfo, viewport.name),
      fullPage: true,
    });
  }

  expect(pageErrors).toEqual([]);
});

test('contém foco, bloqueia rolagem e restaura o gatilho do diálogo', async ({
  page,
}, testInfo) => {
  const pageErrors = collectPageErrors(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await loginAndOpenLibrary(page);

  const trigger = page.locator('.profile-videos__upload-trigger');
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await trigger.click();

  const dialog = page.getByRole('dialog', {
    name: 'Adicionar vídeo ao perfil',
  });
  await expect(dialog).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/cdk-global-scrollblock/);

  const closeButton = page.getByRole('button', {
    name: 'Fechar envio de vídeo',
  });
  await expect(closeButton).toBeFocused();

  for (let index = 0; index < 10; index += 1) {
    await page.keyboard.press('Tab');
    const focusInsideDialog = await dialog.evaluate((element) =>
      element.contains(document.activeElement)
    );
    expect(focusInsideDialog).toBe(true);
  }

  await page.screenshot({
    path: screenshotPath(testInfo, 'dialog-desktop'),
    fullPage: true,
  });

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(page.locator('html')).not.toHaveClass(/cdk-global-scrollblock/);

  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  await expect(dialog).toBeVisible();

  const mobileBox = await dialog.boundingBox();
  expect(mobileBox).not.toBeNull();
  expect(Math.abs(mobileBox.width - 390)).toBeLessThanOrEqual(2);
  expect(Math.abs(mobileBox.height - 844)).toBeLessThanOrEqual(2);

  await page.screenshot({
    path: screenshotPath(testInfo, 'dialog-mobile'),
    fullPage: true,
  });

  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  expect(pageErrors).toEqual([]);
});

test('só anexa e solicita o vídeo após interação', async ({ page }, testInfo) => {
  const pageErrors = collectPageErrors(page);
  let playbackRequests = 0;

  page.on('request', (request) => {
    let decodedUrl = request.url();

    try {
      decodedUrl = decodeURIComponent(decodedUrl);
    } catch {
      // A URL original continua suficiente para o filtro.
    }

    if (decodedUrl.includes(processedPath)) {
      playbackRequests += 1;
    }
  });

  await page.setViewportSize({ width: 1024, height: 900 });
  await loginAndOpenLibrary(page);

  const deferredPlayer = page.locator(
    'video[data-playback-state="deferred"]'
  );
  await expect(deferredPlayer).toBeVisible();
  expect(await deferredPlayer.getAttribute('src')).toBeNull();
  await expect(deferredPlayer).toHaveAttribute('preload', 'none');
  await expect(
    page.locator('video[data-playback-state="ready"]')
  ).toHaveCount(0);
  expect(playbackRequests).toBe(0);

  await deferredPlayer.dispatchEvent('click');

  const readyPlayer = page.locator('video[data-playback-state="ready"]');
  await expect(readyPlayer).toBeVisible();
  await expect(readyPlayer).toHaveAttribute('preload', 'metadata');
  await expect(readyPlayer).toHaveAttribute('src', /127\.0\.0\.1:9199/);
  await expect.poll(() => playbackRequests).toBeGreaterThan(0);

  await page.screenshot({
    path: screenshotPath(testInfo, 'player-ativado'),
    fullPage: true,
  });

  expect(pageErrors).toEqual([]);
});
