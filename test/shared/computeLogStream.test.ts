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

import type {MockInstance} from 'vitest';

import {fetchLogplexOutput, streamLogplexOutput} from '../../src/shared/computeLogStream.js';

// No existing precedent in this repo for stubbing globalThis.fetch -- this small helper resolves
// a real Response/ReadableStream so fetchLogplexOutput/streamLogplexOutput exercise their actual
// body-reading code, not a hand-rolled mock of it.
function stubFetchResponse(response: Response): MockInstance {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
}

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }

      controller.close();
    },
  });
}

describe('computeLogStream.fetchLogplexOutput', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the response body text on a 2xx response', async () => {
    stubFetchResponse(new Response('line one\nline two\n', {status: 200}));

    const result = await fetchLogplexOutput('https://logplex.heroku.com/sessions/abc');

    expect(result).toStrictEqual({output: 'line one\nline two\n', timedOut: false});
  });

  it('passes an abort signal to fetch', async () => {
    const fetchStub = stubFetchResponse(new Response('ok', {status: 200}));

    await fetchLogplexOutput('https://logplex.heroku.com/sessions/abc');

    expect(fetchStub).toHaveBeenCalledWith('https://logplex.heroku.com/sessions/abc', {
      signal: expect.any(AbortSignal) as AbortSignal,
    });
  });

  // A stream that optionally sends `chunks` and then stays open until the caller's signal aborts it.
  function stubNeverClosingStream(chunks: string[]): void {
    const encoder = new TextEncoder();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(encoder.encode(chunk));
          }

          init?.signal?.addEventListener('abort', () => {
            controller.error(init.signal?.reason);
          });
        },
      });
      return new Response(body, {status: 200});
    });
  }

  it('returns the partial output, flagged as timed out, when a never-closing stream sent some lines', async () => {
    stubNeverClosingStream(['line one\n', 'line two\n']);

    const result = await fetchLogplexOutput('https://logplex.heroku.com/sessions/abc', 50);

    expect(result).toStrictEqual({output: 'line one\nline two\n', timedOut: true});
  });

  it('throws a clear timeout error when nothing arrived before the deadline', async () => {
    stubNeverClosingStream([]);

    await expect(fetchLogplexOutput('https://logplex.heroku.com/sessions/abc', 50)).rejects.toThrow(
      'Timed out waiting for the log output',
    );
  });

  it('with idleMs, ends a never-closing stream cleanly once it goes quiet, without flagging a timeout', async () => {
    stubNeverClosingStream(['line one\n', 'line two\n']);

    const result = await fetchLogplexOutput('https://logplex.heroku.com/sessions/abc', 5000, {idleMs: 30});

    expect(result).toStrictEqual({output: 'line one\nline two\n', timedOut: false});
  });

  it('with idleMs, returns empty output rather than a timeout error when the stream never sends anything', async () => {
    stubNeverClosingStream([]);

    const result = await fetchLogplexOutput('https://logplex.heroku.com/sessions/abc', 5000, {idleMs: 30});

    expect(result).toStrictEqual({output: '', timedOut: false});
  });

  it('with idleMs, still reports a timeout when the hard deadline fires first', async () => {
    stubNeverClosingStream(['line one\n']);

    const result = await fetchLogplexOutput('https://logplex.heroku.com/sessions/abc', 30, {idleMs: 5000});

    expect(result).toStrictEqual({output: 'line one\n', timedOut: true});
  });

  it('wraps a non-2xx response as a hard error', async () => {
    stubFetchResponse(new Response('gone', {status: 410}));

    let error: Error | undefined;
    try {
      await fetchLogplexOutput('https://logplex.heroku.com/sessions/abc');
    } catch (error_) {
      error = error_ as Error;
    }

    expect(error).toBeDefined();
    expect(error?.message).toContain('HTTP 410');
  });
});

describe('computeLogStream.streamLogplexOutput', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('splits multi-chunk output into lines, flushing a trailing partial line on EOF', async () => {
    stubFetchResponse(
      new Response(streamOf(['line one\nline t', 'wo\nline three (no trailing newline)']), {status: 200}),
    );
    const lines: string[] = [];

    const reason = await streamLogplexOutput('https://logplex.heroku.com/sessions/abc', line => {
      lines.push(line);
    });

    expect(reason).toBe('eof');
    expect(lines).toEqual(['line one', 'line two', 'line three (no trailing newline)']);
  });

  it('resolves cleanly with "aborted" when the signal is already aborted, without throwing', async () => {
    const controller = new AbortController();
    controller.abort();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      // A real aborted fetch rejects with a DOMException named 'AbortError' -- construct that
      // directly rather than mutating a plain Error's .name. (streamLogplexOutput keys off
      // signal.aborted, not the error name, so this just keeps the simulated reject faithful.)
      throw new DOMException('The operation was aborted.', 'AbortError');
    });
    const lines: string[] = [];

    const reason = await streamLogplexOutput(
      'https://logplex.heroku.com/sessions/abc',
      line => {
        lines.push(line);
      },
      controller.signal,
    );

    expect(reason).toBe('aborted');
    expect(lines).toEqual([]);
  });

  it('wraps a non-2xx response as a hard error', async () => {
    stubFetchResponse(new Response('gone', {status: 410}));

    let error: Error | undefined;
    try {
      await streamLogplexOutput('https://logplex.heroku.com/sessions/abc', () => {
        /* no lines are expected before the error */
      });
    } catch (error_) {
      error = error_ as Error;
    }

    expect(error).toBeDefined();
    expect(error?.message).toContain('HTTP 410');
  });

  it('rethrows a genuine mid-stream read failure that is not an abort', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('connection reset'));
      },
    });
    stubFetchResponse(new Response(body, {status: 200}));

    let error: Error | undefined;
    try {
      await streamLogplexOutput('https://logplex.heroku.com/sessions/abc', () => {
        /* no lines are expected before the error */
      });
    } catch (error_) {
      error = error_ as Error;
    }

    expect(error).toBeDefined();
    expect(error?.message).toContain('connection reset');
  });
});
