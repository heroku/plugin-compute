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

  it('with sse, requests an event stream and emits one line per event even when events coalesce or split across reads', async () => {
    const fetchStub = stubFetchResponse(
      new Response(streamOf(['id: 1\ndata: record one\n\n\nid: 2\ndata: rec', 'ord two\n\n\n', 'id: 3\r\ndata: record three\r\n\r\n']), {
        headers: {'content-type': 'text/event-stream'},
        status: 200,
      }),
    );

    const result = await fetchLogplexOutput('https://logplex.heroku.com/sessions/abc', 5000, {sse: true});

    expect(result).toStrictEqual({output: 'record one\nrecord two\nrecord three\n', timedOut: false});
    expect(fetchStub.mock.calls[0][1]).toMatchObject({headers: {Accept: 'text/event-stream'}});
  });

  it('with sse, splits a multi-line event into lines and drops a trailing incomplete event', async () => {
    stubFetchResponse(
      new Response(streamOf(['data: a\ndata: b\n\ndata: never finished']), {
        headers: {'content-type': 'text/event-stream'},
        status: 200,
      }),
    );

    const result = await fetchLogplexOutput('https://logplex.heroku.com/sessions/abc', 5000, {sse: true});

    expect(result).toStrictEqual({output: 'a\nb\n', timedOut: false});
  });

  it('with idleMs, does not count a slow connect as idle', async () => {
    const encoder = new TextEncoder();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      await new Promise(resolve => {
        setTimeout(resolve, 100);
      });
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('line one\n'));
          init?.signal?.addEventListener('abort', () => {
            controller.error(init.signal?.reason);
          });
        },
      });
      return new Response(body, {status: 200});
    });

    const result = await fetchLogplexOutput('https://logplex.heroku.com/sessions/abc', 5000, {idleMs: 30});

    expect(result).toStrictEqual({output: 'line one\n', timedOut: false});
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

  it('with sse, requests an event stream and emits one line per event', async () => {
    const fetchStub = stubFetchResponse(
      new Response(streamOf(['id: 1\ndata: record one\n\n\nid: 2\ndata: rec', 'ord two\n\n\n']), {
        headers: {'content-type': 'text/event-stream'},
        status: 200,
      }),
    );
    const lines: string[] = [];

    await streamLogplexOutput(
      'https://logplex.heroku.com/sessions/abc',
      line => {
        lines.push(line);
      },
      undefined,
      {sse: true},
    );

    expect(lines).toEqual(['record one', 'record two']);
    expect(fetchStub.mock.calls[0][1]).toMatchObject({headers: {Accept: 'text/event-stream'}});
  });

  it('with sse requested but a plain-text answer, parses newline-delimited lines instead of dropping them', async () => {
    stubFetchResponse(new Response(streamOf(['plain one\nplain two\npartial']), {headers: {'content-type': 'text/plain'}, status: 200}));
    const lines: string[] = [];

    await streamLogplexOutput('https://logplex.heroku.com/sessions/abc', line => {
      lines.push(line);
    }, undefined, {sse: true});

    expect(lines).toEqual(['plain one', 'plain two', 'partial']);
  });

  it('with stallMs, cancels a stream that goes silent without closing and reports "stalled"', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('line one\n'));
          init?.signal?.addEventListener('abort', () => {
            controller.error(init.signal?.reason);
          });
        },
      });
      return new Response(body, {status: 200});
    });
    const lines: string[] = [];
    let chunks = 0;

    const reason = await streamLogplexOutput('https://logplex.heroku.com/sessions/abc', line => {
      lines.push(line);
    }, undefined, {
      onActivity() {
        chunks++;
      },
      stallMs: 30,
    });

    expect(reason).toBe('stalled');
    expect(lines).toEqual(['line one']);
    expect(chunks).toBe(1);
  });

  it('with stallMs, still reports "aborted" when the caller aborts first', async () => {
    const controller = new AbortController();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(stream) {
          init?.signal?.addEventListener('abort', () => {
            stream.error(init.signal?.reason);
          });
        },
      });
      setTimeout(() => {
        controller.abort();
      }, 10);
      return new Response(body, {status: 200});
    });

    const reason = await streamLogplexOutput('https://logplex.heroku.com/sessions/abc', () => undefined, controller.signal, {
      stallMs: 5000,
    });

    expect(reason).toBe('aborted');
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
