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
import {Flags, SfCommand} from '@salesforce/sf-plugins-core';

import {requireAppName, resolveComputeAppNameFromDir, validateName} from '../../../shared/computeApp.js';
import {type StreamEndReason, streamLogplexOutput} from '../../../shared/computeLogStream.js';
import {queryComputeApp, requireHerokuAppId, toComputeAppSummary} from '../../../shared/computeQuery.js';
import {createComputeLogSessionViaProxy, fetchComputeAppViaProxy} from '../../../shared/herokuProxyApi.js';
import {PLUGIN_NAME} from '../../../shared/plugin-name.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages(PLUGIN_NAME, 'compute.tail.runtime-log');

// A Fir session that closes sooner than this was rejected or dropped, not expired, so reconnecting
// would just loop; a real session runs far longer before the server ends it.
const MIN_FIR_SESSION_MS = 5000;

export type ComputeTailRuntimeLogResult = {
  name: string;
};

export default class TailRuntimeLog extends SfCommand<ComputeTailRuntimeLogResult> {
  public static readonly description = messages.getMessage('description');

  // A live stream has no single point at which to emit one JSON result, so this command
  // exposes no --json output. The verb-noun shape mirrors first-party `sf apex tail log`.
  public static readonly enableJsonFlag = false;

  public static readonly examples = messages.getMessages('examples');
  public static readonly flags = {
    name: Flags.string({
      char: 'n',
      env: 'COMPUTE_APP_NAME',
      summary: messages.getMessage('flags.name.summary'),
    }),
    'target-org': Flags.requiredOrg({char: 'o'}),
    'api-version': Flags.orgApiVersion(),
    num: Flags.integer({
      default: 100,
      summary: messages.getMessage('flags.num.summary'),
    }),
  };

  // Org-mediated lookup by --name -- no local project files are read.
  public static readonly requiresProject = false;

  public static readonly summary = messages.getMessage('summary');

  public async run(): Promise<ComputeTailRuntimeLogResult> {
    const {flags} = await this.parse(TailRuntimeLog);
    const {num} = flags;
    const name = requireAppName(flags.name ?? (await resolveComputeAppNameFromDir(process.cwd())));
    validateName(name);

    const connection = flags['target-org'].getConnection(flags['api-version']);
    const record = await queryComputeApp(connection, name);
    const {currentBuild} = toComputeAppSummary(record);

    if (!currentBuild) {
      this.info(messages.getMessage('info.noBuildsFound', [name]));
      return {name};
    }

    const appId = requireHerokuAppId(record, name);
    // Fir sessions are SSE streams with their own framing and a server-side lifetime. The lookup
    // only picks the read mode: if it fails, fall back to the Cedar path and let session creation
    // surface any real proxy failure -- but say so, since a Fir app read that way can show nothing.
    const herokuApp = await fetchComputeAppViaProxy(connection, {appId, name}).catch(() => undefined);
    if (herokuApp?.generation === undefined) {
      this.warn(messages.getMessage('warning.generationUnknown', [name]));
    }

    const isFir = herokuApp?.generation === 'fir';
    // Fir sessions take no line count or tail flag -- they are always a live stream.
    const sessionParams = isFir
      ? {name, appId}
      : {
        name, appId, lines: num, tail: true,
      };
    let session = await createComputeLogSessionViaProxy(connection, sessionParams);

    this.info(messages.getMessage('info.tailStarting', [name]));
    const controller = new AbortController();

    // SfCommand._run() registers SIGINT listeners that throw ExitError from inside the signal
    // event, ahead of any listener added here, so they would kill the process (exit 1, stack
    // trace) before ours could abort the stream. Take over SIGINT for the stream's duration,
    // deliberately displacing every inherited listener (under sf that is SfCommand's own) and
    // restoring them afterwards.
    const inherited = process.listeners('SIGINT');
    process.removeAllListeners('SIGINT');
    process.once('SIGINT', () => {
      controller.abort();
    });

    let wasAborted: boolean;
    let lineCount = 0;
    const onLine = (line: string): void => {
      lineCount++;
      this.log(line);
    };

    try {
      let reason: StreamEndReason;
      let isReconnect: boolean;
      do {
        const startedAt = Date.now();
        // eslint-disable-next-line no-await-in-loop
        reason = await streamLogplexOutput(session.logplexUrl, onLine, controller.signal, {sse: isFir});
        // Fir sessions expire server-side, so a clean close after a real run means "keep following",
        // not "done". A session that dies almost at once is not worth retrying -- that would spin.
        isReconnect = isFir && reason === 'eof' && Date.now() - startedAt >= MIN_FIR_SESSION_MS;
        if (isReconnect) {
          this.info(messages.getMessage('info.tailReconnecting', [name]));
          // eslint-disable-next-line no-await-in-loop
          session = await createComputeLogSessionViaProxy(connection, sessionParams);
        }
      } while (isReconnect);

      wasAborted = reason === 'aborted';
      if (isFir && !wasAborted && lineCount === 0) {
        // A session that closes without a single line is indistinguishable from "nothing happened"
        // unless we say so -- surface it rather than exiting silently.
        this.warn(messages.getMessage('warning.tailEndedWithoutOutput', [name]));
      }

      this.info(
        wasAborted
          ? messages.getMessage('info.tailStopped', [name])
          : messages.getMessage('info.tailStreamEnded', [name]),
      );
    } finally {
      process.removeAllListeners('SIGINT');
      for (const listener of inherited) {
        process.on('SIGINT', listener);
      }
    }

    // 130 = 128 + SIGINT. Set rather than thrown so the quiet stop still exits like an interrupt.
    if (wasAborted) {
      process.exitCode = 130;
    }

    return {name};
  }
}
