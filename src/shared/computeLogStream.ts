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

// On timeout, returns the partial output if any arrived rather than discarding it; throws only
// when nothing arrived before the deadline.
export async function fetchLogplexOutput(
  logplexUrl: string,
  timeoutMs: number = LOGPLEX_FETCH_TIMEOUT_MS,
): Promise<LogplexSnapshot> {
  const signal = AbortSignal.timeout(timeoutMs);
  let output = '';
  try {
    const response = await fetch(logplexUrl, {signal});
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    if (!response.body) {
      return {output: await response.text(), timedOut: false};
    }

    const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    const decoder = new TextDecoder();
    while (true) {
      // Sequential reads of one ordered stream -- there's nothing to parallelize.
      // eslint-disable-next-line no-await-in-loop
      const {done, value} = await reader.read();
      if (done) {
        break;
      }

      output += decoder.decode(value, {stream: true});
    }

    return {output: output + decoder.decode(), timedOut: false};
  } catch (error) {
    if (signal.aborted) {
      if (output.length > 0) {
        return {output, timedOut: true};
      }

      throw messages.createError('error.logFetchTimedOut', [String(Math.round(timeoutMs / 1000))]);
    }

    throw messages.createError('error.logStreamFailed', [(error as Error).message]);
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
): Promise<StreamEndReason> {
  let response: Response;
  try {
    response = await fetch(logplexUrl, {signal});
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
  let buffer = '';
  try {
    while (true) {
      // Sequential reads of one ordered stream -- there's nothing to parallelize.
      // eslint-disable-next-line no-await-in-loop
      const {done, value} = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, {stream: true});
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
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
  if (buffer.length > 0) {
    onLine(buffer);
  }

  return 'eof';
}
