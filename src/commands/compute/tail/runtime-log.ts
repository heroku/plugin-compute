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
import {streamLogplexOutput} from '../../../shared/computeLogStream.js';
import {queryComputeApp, requireHerokuAppId, toComputeAppSummary} from '../../../shared/computeQuery.js';
import {createComputeLogSessionViaProxy} from '../../../shared/herokuProxyApi.js';
import {PLUGIN_NAME} from '../../../shared/plugin-name.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages(PLUGIN_NAME, 'compute.tail.runtime-log');

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
    const session = await createComputeLogSessionViaProxy(connection, {
      name, appId, lines: num, tail: true,
    });

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
    try {
      const reason = await streamLogplexOutput(session.logplexUrl, line => {
        this.log(line);
      }, controller.signal);
      wasAborted = reason === 'aborted';
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
