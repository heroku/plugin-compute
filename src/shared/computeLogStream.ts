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

import { Messages } from '@salesforce/core';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@salesforce/plugin-compute', 'compute.errors');

// logplexUrl is itself the auth mechanism (a short-lived, pre-authorized URL) -- these calls are
// raw fetch against logplex.heroku.com, not connection.request() (wrong host, no Salesforce
// bearer token applies) and not createHerokuClient() (wrong host, no Heroku bearer token held
// client-side). See src/shared/herokuApi.ts's header comment for why that client doesn't apply.

export async function fetchLogplexOutput(logplexUrl: string): Promise<string> {
  try {
    const response = await fetch(logplexUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  } catch (err) {
    throw messages.createError('error.logStreamFailed', [(err as Error).message]);
  }
}

export type StreamEndReason = 'eof' | 'aborted';

// Reports whether the stream ended because the server closed it (EOF) or because the caller's
// AbortSignal fired, rather than leaving the caller to re-derive that from signal.aborted after
// the fact -- ambient signal state can flip between a natural EOF and a same-instant abort,
// misattributing one for the other.
export async function streamLogplexOutput(
  logplexUrl: string,
  onLine: (line: string) => void,
  signal?: AbortSignal
): Promise<StreamEndReason> {
  let response: Response;
  try {
    response = await fetch(logplexUrl, { signal });
  } catch (err) {
    if (signal?.aborted) {
      return 'aborted';
    }
    throw messages.createError('error.logStreamFailed', [(err as Error).message]);
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
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        onLine(line);
      }
    }
  } catch (err) {
    if (signal?.aborted) {
      return 'aborted';
    }
    throw messages.createError('error.logStreamFailed', [(err as Error).message]);
  }

  // Reaching here means reader.read() resolved with done:true, i.e. a genuine server-side close
  // -- not an abort artifact (an aborted fetch rejects the read instead), so this is unambiguously
  // EOF even if the signal happens to fire in the same tick.
  if (buffer.length > 0) {
    onLine(buffer);
  }
  return 'eof';
}
