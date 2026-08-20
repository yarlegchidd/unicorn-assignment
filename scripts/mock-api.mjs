#!/usr/bin/env node
/**
 * Stand-in for the Worker, for working on the frontend without spending Gemini
 * quota. Serves the same NDJSON contract as POST /api/analyze and replays a
 * recorded analysis with realistic pacing.
 *
 *   node scripts/mock-api.mjs            # success, video with transcript
 *   MOCK=image|nobody|silent|error node scripts/mock-api.mjs
 *
 * Point the frontend at it with the usual Vite proxy (it listens on 8788).
 */

import { createServer } from 'node:http';

const SCENARIO = process.env.MOCK ?? 'video';
const PORT = Number(process.env.PORT ?? 8788);

const base = {
  source: {
    fileId: '1RecmQXu2U-p_p1XPGrqRmialbSa63eDx',
    fileName: 'multiethnic female middle-aged.mp4',
    mimeType: 'video/mp4',
    kind: 'video',
    byteSize: 14034059,
  },
  sceneSummary: 'A middle-aged woman sits in the driver\u2019s seat of a car and speaks directly to the camera.',
  subject: {
    present: true,
    attributes: {
      ethnicity: 'multiethnic',
      gender: 'female',
      ageBand: 'middle-aged',
      activity: 'talking',
      hairColor: 'blonde',
      build: 'average',
      outfit: 'casual',
    },
    confidence: 'high',
    note: null,
  },
  speech: {
    detected: true,
    language: 'en',
    transcript:
      'After my divorce, I was done with men. Done. Every date, games, ghosts, walking red flags. So I just stopped trying. Then I found this random site on Instagram, and honestly? I almost closed the tab. But I did not. And three weeks later I met someone who actually calls when he says he will.',
  },
  meta: { model: 'gemini-3.7-flash', passes: ['analysis'], elapsedMs: 17900, cached: false },
};

const SCENARIOS = {
  video: { steps: ['resolving', 'fetching', 'staging', 'transcoding', 'reading'], result: base },
  image: {
    steps: ['resolving', 'fetching', 'reading'],
    result: {
      ...base,
      source: {
        ...base.source,
        fileName: 'couple asian male young multiethnic female middle-aged.png',
        mimeType: 'image/png',
        kind: 'image',
        byteSize: 2445370,
      },
      sceneSummary: 'A man and a woman hold each other on a busy pedestrian street in South Korea.',
      subject: {
        present: true,
        attributes: {
          ethnicity: 'asian',
          gender: 'male',
          ageBand: 'young',
          activity: 'hugging',
          hairColor: 'black',
          build: 'athletic',
          outfit: 'casual',
        },
        confidence: 'high',
        note: null,
      },
      speech: { detected: false, language: null, transcript: null },
    },
  },
  nobody: {
    steps: ['resolving', 'fetching', 'staging', 'transcoding', 'reading'],
    result: {
      ...base,
      sceneSummary: 'An empty sunlit apartment with a phone on the table, no person on screen.',
      subject: { present: false, attributes: null, confidence: null, note: null },
      speech: {
        detected: true,
        language: 'uk',
        transcript: '\u0417\u043d\u0430\u0439\u0434\u0438 \u0442\u043e\u0433\u043e, \u0445\u0442\u043e \u0448\u0443\u043a\u0430\u0454 \u0442\u0435\u0431\u0435. \u0417\u0430\u0440\u0435\u0454\u0441\u0442\u0440\u0443\u0439\u0441\u044f \u0441\u044c\u043e\u0433\u043e\u0434\u043d\u0456.',
      },
    },
  },
  silent: {
    steps: ['resolving', 'fetching', 'staging', 'transcoding', 'reading'],
    result: {
      ...base,
      subject: { ...base.subject, confidence: 'low', note: 'face turned away for most of the clip' },
      speech: { detected: false, language: null, transcript: null },
    },
  },
  error: {
    steps: ['resolving', 'fetching'],
    error: {
      code: 'drive_forbidden',
      message: 'Google Drive served a sign-in page instead of the file.',
      hint: 'Open the file in Drive and set sharing to "Anyone with the link".',
    },
  },
};

const DETAILS = {
  resolving: undefined,
  fetching: 'Pulling the file from Google Drive',
  staging: 'Uploading the file to Gemini',
  transcoding: 'Gemini is preparing the video',
  reading: 'Gemini is watching the clip and listening to the audio',
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function text(request) {
  let body = '';
  for await (const chunk of request) body += chunk;
  return body || '{}';
}

createServer(async (request, response) => {
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  };

  if (request.method === 'OPTIONS') {
    response.writeHead(204, cors).end();
    return;
  }

  const { pathname } = new URL(request.url, 'http://localhost');

  if (pathname === '/api/health') {
    response.writeHead(200, { ...cors, 'content-type': 'application/json' });
    response.end(JSON.stringify({ ok: true, service: 'mock', models: ['mock'] }));
    return;
  }

  // Previews are cheap and quota-free, so the mock serves the real bytes.
  if (pathname === '/api/preview') {
    const src = new URL(request.url, 'http://localhost').searchParams.get('src') ?? '';
    const fileId = /[\w-]{20,}/.exec(src)?.[0];
    if (!fileId) {
      response.writeHead(400, cors).end();
      return;
    }
    const upstream = await fetch(
      `https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`,
      { headers: request.headers.range ? { range: request.headers.range } : {} },
    );
    response.writeHead(upstream.status, {
      ...cors,
      'content-type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      'accept-ranges': 'bytes',
    });
    response.end(Buffer.from(await upstream.arrayBuffer()));
    return;
  }

  if (pathname === '/api/analyze/batch') {
    const body = JSON.parse(await text(request));
    const urls = body.urls ?? [];
    response.writeHead(200, { ...cors, 'content-type': 'application/x-ndjson' });
    const emit = (event) => response.write(`${JSON.stringify(event)}\n`);

    emit({ event: 'queued', concurrency: 3, items: urls.map((url, id) => ({ id, url })) });

    let succeeded = 0;
    let failed = 0;
    await Promise.all(
      urls.map(async (_url, id) => {
        await sleep(400 + id * 250);
        emit({ event: 'progress', id, step: 'fetching', detail: DETAILS.fetching });
        await sleep(500 + id * 350);
        emit({ event: 'progress', id, step: 'reading', detail: DETAILS.reading });
        await sleep(700 + id * 200);

        // Make the third row fail so the mixed-outcome layout is exercised.
        if (id === 2) {
          failed += 1;
          emit({ event: 'failed', id, error: SCENARIOS.error.error });
          return;
        }
        succeeded += 1;
        const source = id % 2 === 0 ? SCENARIOS.video.result : SCENARIOS.image.result;
        emit({ event: 'complete', id, result: source });
      }),
    );

    emit({ event: 'done', summary: { total: urls.length, succeeded, failed } });
    response.end();
    return;
  }

  if (pathname !== '/api/analyze') {
    response.writeHead(404, cors).end();
    return;
  }

  const scenario = SCENARIOS[SCENARIO] ?? SCENARIOS.video;
  response.writeHead(200, { ...cors, 'content-type': 'application/x-ndjson' });

  const write = (event) => response.write(`${JSON.stringify(event)}\n`);

  for (const step of scenario.steps) {
    write({ event: 'progress', step, detail: DETAILS[step] });
    await sleep(step === 'transcoding' ? 1400 : 600);
  }

  if (scenario.error) write({ event: 'failed', error: scenario.error });
  else write({ event: 'complete', result: scenario.result });

  response.end();
}).listen(PORT, () => {
  console.log(`mock api (${SCENARIO}) on http://localhost:${PORT}`);
});
