/*
 * Copyright 2026, Salesforce, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type {Mock} from 'vitest';

import {backoffMs, followFirLogSession} from '../../src/shared/computeLogFollow.js';

const SESSION = {logplexUrl: 'https://logplex.heroku.com/sessions/abc'};

function sseResponse(records: string[], init?: RequestInit, isHanging = false): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const [i, record] of records.entries()) {
        controller.enqueue(encoder.encode(`id: ${i}\ndata: ${record}\n\n\n`));
      }

      if (isHanging) {
        init?.signal?.addEventListener('abort', () => {
          controller.error(init.signal?.reason);
        });
      } else {
        controller.close();
      }
    },
  });
  return new Response(body, {headers: {'content-type': 'text/event-stream'}, status: 200});
}

describe('computeLogFollow.followFirLogSession', () => {
  const notices: unknown[] = [];
  const lines: string[] = [];
  const sleeps: number[] = [];
  let createSession: Mock<() => Promise<{logplexUrl: string}>>;
  let controller: AbortController;

  const follow = async (options: {maxFailures?: number; minSessionMs?: number; stallMs?: number} = {}) =>
    followFirLogSession({
      createSession,
      initialSession: SESSION,
      minSessionMs: 0,
      onLine(line) {
        lines.push(line);
      },
      onNotice(notice) {
        notices.push(notice);
      },
      signal: controller.signal,
      async sleep(ms) {
        sleeps.push(ms);
      },
      ...options,
    });

  beforeEach(() => {
    notices.length = 0;
    lines.length = 0;
    sleeps.length = 0;
    controller = new AbortController();
    createSession = vi.fn<() => Promise<{logplexUrl: string}>>().mockResolvedValue(SESSION);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('backs off exponentially from 500ms and caps at 5s', () => {
    expect([1, 2, 3, 4, 5, 6].map(n => backoffMs(n))).toEqual([500, 1000, 2000, 4000, 5000, 5000]);
  });

  it('recreates the session at once after a clean close following a real run', async () => {
    const fetchStub = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementationOnce(async () => sseResponse(['one']))
      .mockImplementationOnce(async (_url, init) => {
        const response = sseResponse(['two'], init, true);
        setTimeout(() => {
          controller.abort();
        }, 10);
        return response;
      });

    const result = await follow();

    expect(result).toBe('aborted');
    expect(lines).toEqual(['one', 'two']);
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(fetchStub).toHaveBeenCalledTimes(2);
    expect(notices).toEqual([{kind: 'expired'}]);
    expect(sleeps).toEqual([]);
  });

  it('recreates a silent stream after stallMs instead of hanging', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(async (_url, init) => sseResponse(['before stall'], init, true))
      .mockImplementationOnce(async (_url, init) => {
        setTimeout(() => {
          controller.abort();
        }, 10);
        return sseResponse(['after stall'], init, true);
      });

    const result = await follow({stallMs: 30});

    expect(result).toBe('aborted');
    expect(lines).toEqual(['before stall', 'after stall']);
    expect(notices).toEqual([{kind: 'stalled'}]);
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it('retries a transport error with backoff and resumes following', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockImplementationOnce(async (_url, init) => {
        setTimeout(() => {
          controller.abort();
        }, 10);
        return sseResponse(['recovered'], init, true);
      });

    const result = await follow();

    expect(result).toBe('aborted');
    expect(lines).toEqual(['recovered']);
    expect(sleeps).toEqual([500]);
    expect(notices).toEqual([
      {
        attempt: 1, delayMs: 500, kind: 'retrying', max: 5, reason: expect.stringContaining('socket hang up') as string,
      },
    ]);
  });

  it('retries a session that closes early with growing backoff, then gives up after maxFailures', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => sseResponse([]));

    const result = await follow({maxFailures: 3, minSessionMs: 60_000});

    expect(result).toBe('gave-up');
    expect(sleeps).toEqual([500, 1000, 2000]);
    expect(createSession).toHaveBeenCalledTimes(3);
  });

  it('rethrows the last error once the failures are exhausted', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('proxy terminated'));

    await expect(follow({maxFailures: 2, minSessionMs: 60_000})).rejects.toThrow('proxy terminated');
    expect(sleeps).toEqual([500, 1000]);
  });

  it('counts a failed session creation against the same budget', async () => {
    createSession.mockRejectedValue(new Error('proxy 502'));
    vi.spyOn(globalThis, 'fetch').mockImplementationOnce(async () => sseResponse([]));

    await expect(follow({maxFailures: 2, minSessionMs: 60_000})).rejects.toThrow('proxy 502');
    expect(createSession).toHaveBeenCalledTimes(2);
  });

  it('resets the failure count after a healthy session', async () => {
    let now = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(async () => sseResponse([])) // early close: failure 1
      .mockImplementationOnce(async () => {
        now += 10_000; // healthy run, then clean close
        return sseResponse(['x']);
      })
      .mockImplementationOnce(async () => sseResponse([])) // early close: failure counts from 1 again
      .mockImplementationOnce(async (_url, init) => {
        setTimeout(() => {
          controller.abort();
        }, 10);
        return sseResponse(['end'], init, true);
      });

    await follow({minSessionMs: 5000});

    expect(sleeps).toEqual([500, 500]);
  });

  it('returns aborted without recreating anything when the signal is already aborted', async () => {
    controller.abort();
    const fetchStub = vi.spyOn(globalThis, 'fetch');

    expect(await follow()).toBe('aborted');
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
