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

    expect(result).toBe('line one\nline two\n');
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
