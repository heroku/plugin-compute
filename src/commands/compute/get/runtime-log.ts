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
import {fetchLogplexOutput} from '../../../shared/computeLogStream.js';
import {queryComputeApp, requireHerokuAppId, toComputeAppSummary} from '../../../shared/computeQuery.js';
import {createComputeLogSessionViaProxy, fetchComputeAppViaProxy} from '../../../shared/herokuProxyApi.js';
import {PLUGIN_NAME} from '../../../shared/plugin-name.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages(PLUGIN_NAME, 'compute.get.runtime-log');

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

    const connection = flags['target-org'].getConnection();
    const record = await queryComputeApp(connection, name);
    const {currentBuild} = toComputeAppSummary(record);

    if (!currentBuild) {
      this.info(messages.getMessage('info.noBuildsFound', [name]));
      return {name};
    }

    const appId = requireHerokuAppId(record, name);
    // Fir apps keep no log history -- their session URL is a live stream that never closes -- so
    // fail fast before creating a session. The lookup is only a guard: if it fails, or the
    // generation is unknown, fall through to the Cedar path (the fetch timeout still bounds it) and
    // let session creation surface any real proxy failure.
    const herokuApp = await fetchComputeAppViaProxy(connection, {appId, name}).catch(() => undefined);
    if (herokuApp?.generation === 'fir') {
      throw messages.createError('error.firNoLogHistory', [name]);
    }

    const session = await createComputeLogSessionViaProxy(connection, {
      name, appId, lines: num, tail: false,
    });

    const {output, timedOut} = await fetchLogplexOutput(session.logplexUrl);
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
