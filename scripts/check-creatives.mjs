#!/usr/bin/env node
/**
 * Runs the six creatives from the brief through a running API and prints a
 * compact report. Used to sanity-check prompt changes -- the Drive filenames
 * happen to contain the expected tags, so the "expected" column is free.
 *
 *   node scripts/check-creatives.mjs [apiBase]
 */

const API = (process.argv[2] ?? 'http://localhost:8788').replace(/\/$/, '');

const CREATIVES = [
  '1vd8C8tLUnZo4-rfozcQ_oDGqVc4ZRW3W',
  '1jITp26v4aN8fdWa6lsiQnY4zjo7KEOxe',
  '1RecmQXu2U-p_p1XPGrqRmialbSa63eDx',
  '1eFbqsGVh0zatfhhD94bfU-Yz7ow9uBSL',
  '1e6VM-74qJ4GPIwRS2aPmL0TUKogeSlbT',
  '1hJGB8OQGvEfJL-EsS61IOZzOpoefaDyQ',
].map((id) => `https://drive.google.com/file/d/${id}/view`);

async function run(url) {
  const started = Date.now();
  const response = await fetch(`${API}/api/analyze`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    return { failed: body.error ?? { code: `http_${response.status}` } };
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let outcome = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);
      if (event.event === 'complete') outcome = { result: event.result };
      if (event.event === 'failed') outcome = { failed: event.error };
    }
  }

  return { ...outcome, wallMs: Date.now() - started };
}

let failures = 0;

for (const [index, url] of CREATIVES.entries()) {
  process.stdout.write(`\n[${index + 1}/6] ${url}\n`);
  const { result, failed, wallMs } = await run(url);

  if (failed) {
    failures += 1;
    console.log(`  FAILED  ${failed.code}: ${failed.message}`);
    continue;
  }

  const { source, subject, speech, sceneSummary, meta } = result;
  const a = subject.attributes ?? {};

  console.log(`  expected  ${source.fileName ?? '(no filename)'}`);
  console.log(`  file      ${source.kind} ${source.mimeType} ${(source.byteSize / 1048576).toFixed(1)} MB`);
  console.log(
    `  tagged    ${subject.present ? [a.ethnicity, a.gender, a.ageBand, a.activity, a.hairColor, a.build, a.outfit].join(' / ') : 'no person in focus'}`,
  );
  console.log(`  certainty ${subject.confidence ?? '-'}${subject.note ? ` (${subject.note})` : ''}`);
  console.log(`  scene     ${sceneSummary ?? '-'}`);
  console.log(
    `  speech    ${speech.detected ? `${speech.language ?? '??'}: ${JSON.stringify((speech.transcript ?? '').slice(0, 160))}` : 'none'}`,
  );
  console.log(`  timing    ${(wallMs / 1000).toFixed(1)}s via ${meta.passes.join(' + ')}`);
}

console.log(`\n${CREATIVES.length - failures}/${CREATIVES.length} creatives analysed.`);
process.exit(failures > 0 ? 1 : 0);
