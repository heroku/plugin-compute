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
import {fetchLogplexOutput, LOGPLEX_FETCH_TIMEOUT_MS} from '../../../shared/computeLogStream.js';
import {queryComputeApp, requireHerokuAppId, toComputeAppSummary} from '../../../shared/computeQuery.js';
import {createComputeLogSessionViaProxy, fetchComputeAppViaProxy} from '../../../shared/herokuProxyApi.js';
import {PLUGIN_NAME} from '../../../shared/plugin-name.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages(PLUGIN_NAME, 'compute.get.runtime-log');

// How long a Fir log session may stay silent before the one-shot read treats the buffered output as
// complete. Long enough to cover session setup and the initial backfill, short enough to feel instant.
const FIR_IDLE_MS = 3000;

export type ComputeGetRuntimeLogResult = {
  lines?: string[];
  name: string;
};

// Drops the single trailing empty element split('\n') produces when the text ends in a newline,
// without dropping genuine blank lines in the middle of the output.
function splitLines(text: string): string[] {
  const lines = text.split('\n');
  if (lines.length > 0 && lines.at(-1) === '') {
    lines.pop();
  }

  return lines;
}

export default class RuntimeLog extends SfCommand<ComputeGetRuntimeLogResult> {
  public static readonly description = messages.getMessage('description');
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

  public async run(): Promise<ComputeGetRuntimeLogResult> {
    const {flags} = await this.parse(RuntimeLog);
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
    // Fir apps keep no log history -- their session URL is a live stream that never closes -- so a
    // one-shot read can't wait for EOF; it drains whatever is buffered and stops once the stream
    // goes idle. The lookup only picks the read mode: if it fails, or the generation is unknown, fall
    // through to the Cedar path (the fetch timeout still bounds it) and let session creation surface
    // any real proxy failure -- but say so, since a Fir app read that way waits out the full timeout.
    const herokuApp = await fetchComputeAppViaProxy(connection, {appId, name}).catch(() => undefined);
    if (herokuApp?.generation === undefined) {
      this.warn(messages.getMessage('warning.generationUnknown', [name]));
    }

    const isFir = herokuApp?.generation === 'fir';

    // Fir sessions take no line count or tail flag -- they are always a live stream.
    const session = await createComputeLogSessionViaProxy(
      connection,
      isFir
        ? {name, appId}
        : {
          name, appId, lines: num, tail: false,
        },
    );

    const {output, timedOut} = await fetchLogplexOutput(
      session.logplexUrl,
      LOGPLEX_FETCH_TIMEOUT_MS,
      isFir ? {idleMs: FIR_IDLE_MS, sse: true} : {},
    );
    const lines = splitLines(output);
    if (lines.length === 0) {
      this.info(messages.getMessage('info.noLogLines', [name]));
      return {name};
    }

    for (const line of lines) this.log(line);
    if (timedOut) this.warn(messages.getMessage('warning.logFetchPartial'));
    return {name, lines};
  }
}
