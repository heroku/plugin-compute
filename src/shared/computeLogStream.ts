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

import {Messages} from '@salesforce/core';

import {PLUGIN_NAME} from './plugin-name.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages(PLUGIN_NAME, 'compute.errors');

// logplexUrl/outputStreamUrl are themselves the auth mechanism (short-lived, pre-authorized URLs
// handed back by a Heroku proxy call) -- these calls are raw fetch against the URL Heroku gave
// us, not connection.request() (wrong host, no Salesforce bearer token applies) and not a
// Heroku-token-bearing client (wrong host, no Heroku bearer token held client-side).

// Fir apps keep no log history, so their session URL streams and never closes; the timeout also
// covers a Cedar logplex that stalls, so the one-shot fetch can never wait indefinitely.
export const LOGPLEX_FETCH_TIMEOUT_MS = 30_000;

export type LogplexSnapshot = {
  output: string;
  // True when the deadline fired after some output had arrived, so `output` is what was received so far.
  timedOut: boolean;
};

export type LogplexFetchOptions = {
  // Stop reading once no data has arrived for this long, treating what was received as the complete
  // snapshot (not a timeout). For Fir session URLs, which stream live and never close, so there is
  // no EOF to wait for; unset for Cedar, where the server closes the response itself.
  idleMs?: number;
  // Request and parse the session as Server-Sent Events. Fir session URLs only frame records
  // (one event per record) when asked for text/event-stream; without it they send bare chunks whose
  // boundaries are arbitrary. Unset for Cedar, which serves newline-delimited text.
  sse?: boolean;
};

// Cedar requests stay byte-for-byte as before: the Accept header is only added when SSE is wanted.
function requestInit(signal: AbortSignal | undefined, sse: boolean | undefined): RequestInit {
  return sse ? {headers: {Accept: 'text/event-stream'}, signal} : {signal};
}

type LineSplitter = {
  flush: () => string[];
  push: (chunk: string) => string[];
};

function createNewlineSplitter(): LineSplitter {
  let buffer = '';
  return {
    flush() {
      const rest = buffer;
      buffer = '';
      return rest.length > 0 ? [rest] : [];
    },
    push(chunk) {
      const lines = (buffer + chunk).split('\n');
      buffer = lines.pop() ?? '';
      return lines;
    },
  };
}

// Events end at a blank line; an event's `data:` fields carry the record (id/comment/other fields
// are ignored). A trailing incomplete event is dropped, as the SSE spec does for a closed stream.
function createSseSplitter(): LineSplitter {
  let buffer = '';
  return {
    flush: () => [],
    push(chunk) {
      const events = (buffer + chunk).replaceAll('\r\n', '\n').split('\n\n');
      buffer = events.pop() ?? '';
      return events.flatMap(event =>
        event
          .split('\n')
          .filter(field => field.startsWith('data:'))
          .map(field => field.slice('data:'.length).replace(/^ /v, ''))
          .join('\n')
          .split(/\n+/v)
          .filter(line => line.length > 0),
      );
    },
  };
}

// On timeout, returns the partial output if any arrived rather than discarding it; throws only
// when nothing arrived before the deadline. With `idleMs`, an idle gap ends the read cleanly
// (including with no output at all) instead of counting as a timeout.
export async function fetchLogplexOutput(
  logplexUrl: string,
  timeoutMs: number = LOGPLEX_FETCH_TIMEOUT_MS,
  options: LogplexFetchOptions = {},
): Promise<LogplexSnapshot> {
  const {idleMs, sse} = options;
  const deadline = AbortSignal.timeout(timeoutMs);
  const idle = new AbortController();
  const signal = idleMs === undefined ? deadline : AbortSignal.any([deadline, idle.signal]);
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const armIdleTimer = (): void => {
    if (idleMs === undefined) {
      return;
    }

    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idle.abort();
    }, idleMs);
  };

  const splitter = sse ? createSseSplitter() : undefined;
  const decoder = new TextDecoder();
  const toOutput = (text: string): string =>
    splitter ? splitter.push(text).map(line => `${line}\n`).join('') : text;
  const decode = (bytes?: Uint8Array): string => toOutput(decoder.decode(bytes, {stream: bytes !== undefined}));

  let output = '';
  try {
    const response = await fetch(logplexUrl, requestInit(signal, sse));
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    if (!response.body) {
      return {output: toOutput(await response.text()), timedOut: false};
    }

    // Armed only once connected, so "idle" means connected-but-silent, not slow to connect.
    armIdleTimer();
    const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    while (true) {
      // Sequential reads of one ordered stream -- there's nothing to parallelize.
      // eslint-disable-next-line no-await-in-loop
      const {done, value} = await reader.read();
      if (done) {
        break;
      }

      armIdleTimer();
      output += decode(value);
    }

    return {output: output + decode(), timedOut: false};
  } catch (error) {
    if (idle.signal.aborted && !deadline.aborted) {
      return {output: output + decode(), timedOut: false};
    }

    if (signal.aborted) {
      if (output.length > 0) {
        return {output, timedOut: true};
      }

      throw messages.createError('error.logFetchTimedOut', [String(Math.round(timeoutMs / 1000))]);
    }

    throw messages.createError('error.logStreamFailed', [(error as Error).message]);
  } finally {
    clearTimeout(idleTimer);
  }
}

// Bounded one-shot fetch, not a stream -- `get build-log` prints one finished-or-in-progress
// build's log, unlike `tail runtime-log`'s ongoing runtime stream. Explicit Accept: output_stream_url
// serves either text/plain or text/event-stream, and this call wants the plain-text snapshot.
export async function fetchBuildOutputStream(outputStreamUrl: string): Promise<string> {
  try {
    const response = await fetch(outputStreamUrl, {headers: {Accept: 'text/plain'}});
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.text();
  } catch (error) {
    throw messages.createError('error.buildOutputFetchFailed', [(error as Error).message]);
  }
}

export type StreamEndReason = 'aborted' | 'eof';

// Reports whether the stream ended because the server closed it (EOF) or because the caller's
// AbortSignal fired, rather than leaving the caller to re-derive that from signal.aborted after
// the fact -- ambient signal state can flip between a natural EOF and a same-instant abort,
// misattributing one for the other.
export async function streamLogplexOutput(
  logplexUrl: string,
  onLine: (line: string) => void,
  signal?: AbortSignal,
  options: Pick<LogplexFetchOptions, 'sse'> = {},
): Promise<StreamEndReason> {
  let response: Response;
  try {
    response = await fetch(logplexUrl, requestInit(signal, options.sse));
  } catch (error) {
    if (signal?.aborted) {
      return 'aborted';
    }

    throw messages.createError('error.logStreamFailed', [(error as Error).message]);
  }

  if (!response.ok) {
    throw messages.createError('error.logStreamFailed', [`HTTP ${response.status}`]);
  }

  if (!response.body) {
    return 'eof';
  }

  // response.body's ReadableStream defaults to the <any> type param, which cascades unsafe-any
  // lint errors through the destructured read() result -- pin it to the byte-stream shape fetch
  // actually returns.
  const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const decoder = new TextDecoder();
  const splitter = options.sse ? createSseSplitter() : createNewlineSplitter();
  try {
    while (true) {
      // Sequential reads of one ordered stream -- there's nothing to parallelize.
      // eslint-disable-next-line no-await-in-loop
      const {done, value} = await reader.read();
      if (done) {
        break;
      }

      for (const line of splitter.push(decoder.decode(value, {stream: true}))) {
        onLine(line);
      }
    }
  } catch (error) {
    if (signal?.aborted) {
      return 'aborted';
    }

    throw messages.createError('error.logStreamFailed', [(error as Error).message]);
  }

  // Reaching here means reader.read() resolved with done:true, i.e. a genuine server-side close
  // -- not an abort artifact (an aborted fetch rejects the read instead), so this is unambiguously
  // EOF even if the signal happens to fire in the same tick.
  for (const line of splitter.flush()) {
    onLine(line);
  }

  return 'eof';
}
