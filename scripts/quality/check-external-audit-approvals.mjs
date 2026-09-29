import fs from 'node:fs';
import process from 'node:process';

const approvalsPath =
  'docs/compliance/external-audit/approvals.json';

const fail = (message) => {
  console.error(`[external-audit] ${message}`);
  process.exit(1);
};

if (!fs.existsSync(approvalsPath)) {
  fail(`missing ${approvalsPath}`);
}

let document;
try {
  document = JSON.parse(fs.readFileSync(approvalsPath, 'utf8'));
} catch {
  fail('approval record is not valid JSON');
}

if (document?.schemaVersion !== 1) {
  fail('unsupported approval schemaVersion');
}

const releaseSha = String(document?.releaseSha ?? '').trim();
if (!/^[a-f0-9]{40}$/.test(releaseSha)) {
  fail('releaseSha must be the exact 40-character reviewed commit SHA');
}

const expectedSha = String(
  process.env.RELEASE_SHA ?? process.env.GITHUB_SHA ?? ''
).trim();

if (expectedSha && releaseSha !== expectedSha) {
  fail(
    `approval SHA ${releaseSha} does not match current release SHA ${expectedSha}`
  );
}

const tracks = [
  ['security', document?.security],
  ['privacyModeration', document?.privacyModeration],
  ['legalAdultAdvertising', document?.legalAdultAdvertising],
];

for (const [name, track] of tracks) {
  if (track?.status !== 'APPROVED') {
    fail(`${name} status is ${String(track?.status ?? 'MISSING')}; APPROVED required`);
  }

  for (const field of ['reviewer', 'organization', 'reviewedAt', 'reportReference']) {
    if (!String(track?.[field] ?? '').trim()) {
      fail(`${name} is APPROVED but ${field} is missing`);
    }
  }

  if (Number.isNaN(Date.parse(track.reviewedAt))) {
    fail(`${name}.reviewedAt is not a valid date`);
  }
}

console.log(
  `[external-audit] OK: independent security, privacy/moderation and legal adult/advertising approvals cover ${releaseSha}.`
);
