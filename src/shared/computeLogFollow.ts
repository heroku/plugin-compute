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

import {type StreamEndReason, streamLogplexOutput} from './computeLogStream.js';

// A Fir session ends on its own: the server expires it (about 15 min), and a dropped connection or a
// silent half-open socket looks the same from here. Following means recreating the session each time,
// not treating the end as "done".

// A session that closes sooner than this was rejected or dropped, not expired, so it counts as a
// failure (with backoff) rather than a normal reconnect.
export const MIN_FIR_SESSION_MS = 5000;
// A stream silent this long without closing is treated as dead and recreated.
export const FIR_STALL_MS = 15 * 60_000;
// Consecutive failed sessions tolerated before giving up; any healthy session resets the count.
export const MAX_CONSECUTIVE_FAILURES = 5;
const BACKOFF_BASE_MS = 500;
const BACKOFF_MAX_MS = 5000;

export type FollowNotice =
  | {attempt: number; delayMs: number; kind: 'retrying'; max: number; reason: string}
  | {kind: 'expired'}
  | {kind: 'stalled'};

export type FollowOptions = {
  createSession: () => Promise<{logplexUrl: string}>;
  initialSession: {logplexUrl: string};
  maxFailures?: number;
  minSessionMs?: number;
  onLine: (line: string) => void;
  onNotice: (notice: FollowNotice) => void;
  signal: AbortSignal;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  stallMs?: number;
};

export type FollowResult = 'aborted' | 'gave-up';

export function backoffMs(failures: number): number {
  return Math.min(BACKOFF_BASE_MS * (2 ** (failures - 1)), BACKOFF_MAX_MS);
}

async function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }

    signal.addEventListener('abort', done, {once: true});
  });
}

// Follows a Fir log session until the caller aborts or the sessions keep failing. Clean ends after a
// real run reconnect at once; early closes, creation failures and transport errors back off
// (500ms to 5s) and give up after `maxFailures` in a row, rethrowing the last error if there was one.
export async function followFirLogSession(options: FollowOptions): Promise<FollowResult> {
  const {
    createSession,
    maxFailures = MAX_CONSECUTIVE_FAILURES,
    minSessionMs = MIN_FIR_SESSION_MS,
    onLine,
    onNotice,
    signal,
    sleep = abortableSleep,
    stallMs = FIR_STALL_MS,
  } = options;
  let session: undefined | {logplexUrl: string} = options.initialSession;
  let failures = 0;

  while (!signal.aborted) {
    let reason: StreamEndReason | undefined;
    let error: Error | undefined;
    const startedAt = Date.now();
    try {
      // Session creation and reading share one failure budget, so a proxy outage backs off too.
      // eslint-disable-next-line no-await-in-loop
      session ??= await createSession();
      // eslint-disable-next-line no-await-in-loop
      reason = await streamLogplexOutput(session.logplexUrl, onLine, signal, {sse: true, stallMs});
    } catch (error_) {
      error = error_ as Error;
    }

    if (reason === 'aborted' || signal.aborted) {
      return 'aborted';
    }

    session = undefined;
    const isRanLong = Date.now() - startedAt >= minSessionMs;
    if (isRanLong) {
      failures = 0;
      if (reason !== undefined) {
        onNotice({kind: reason === 'stalled' ? 'stalled' : 'expired'});
        continue;
      }
    }

    failures++;
    if (failures > maxFailures) {
      if (error) {
        throw error;
      }

      return 'gave-up';
    }

    const delayMs = backoffMs(failures);
    onNotice({
      attempt: failures, delayMs, kind: 'retrying', max: maxFailures, reason: error?.message ?? 'the session closed early',
    });
    // eslint-disable-next-line no-await-in-loop
    await sleep(delayMs, signal);
  }

  return 'aborted';
}
