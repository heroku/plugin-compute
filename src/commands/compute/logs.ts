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

import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { validateName } from '../../shared/computeApp.js';
import { queryComputeApp, toComputeAppSummary } from '../../shared/computeQuery.js';
import { createComputeLogSession } from '../../shared/computeConnectApi.js';
import { fetchLogplexOutput, streamLogplexOutput } from '../../shared/computeLogStream.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@salesforce/plugin-compute', 'compute.logs');

export type ComputeLogsResult = {
  name: string;
  lines?: string[];
};

// Drops the single trailing empty element split('\n') produces when the text ends in a newline,
// without dropping genuine blank lines in the middle of the output.
function splitLines(text: string): string[] {
  const lines = text.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

export default class Logs extends SfCommand<ComputeLogsResult> {
  public static readonly state = 'beta';
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');
  // Org-mediated lookup by --name -- no local project files are read.
  public static readonly requiresProject = false;

  public static readonly flags = {
    name: Flags.string({
      char: 'n',
      required: true,
      summary: messages.getMessage('flags.name.summary'),
    }),
    'target-org': Flags.requiredOrg({ char: 'o' }),
    num: Flags.integer({
      default: 100,
      summary: messages.getMessage('flags.num.summary'),
    }),
    // Unbounded/interactive, so there's no single point to emit one JSON result -- oclif
    // validates this against the built-in --json flag for us.
    tail: Flags.boolean({
      default: false,
      summary: messages.getMessage('flags.tail.summary'),
      exclusive: ['json'],
    }),
  };

  public async run(): Promise<ComputeLogsResult> {
    const { flags } = await this.parse(Logs);
    const { name, num, tail } = flags;
    validateName(name);

    const connection = flags['target-org'].getConnection();
    const record = await queryComputeApp(connection, name);
    const { currentBuild } = toComputeAppSummary(record);

    if (!currentBuild) {
      this.info(messages.getMessage('info.noBuildsFound', [name]));
      return { name };
    }

    const session = await createComputeLogSession(connection, { name, lines: num, tail });

    if (!tail) {
      const output = await fetchLogplexOutput(session.logplexUrl);
      const lines = splitLines(output);
      if (lines.length === 0) {
        this.info(messages.getMessage('info.noLogLines', [name]));
        return { name };
      }
      lines.forEach((line) => this.log(line));
      return { name, lines };
    }

    this.info(messages.getMessage('info.tailStarting', [name]));
    const controller = new AbortController();
    const onSigint = (): void => controller.abort();
    process.once('SIGINT', onSigint);
    try {
      const reason = await streamLogplexOutput(session.logplexUrl, (line) => this.log(line), controller.signal);
      this.info(
        reason === 'aborted'
          ? messages.getMessage('info.tailStopped', [name])
          : messages.getMessage('info.tailStreamEnded', [name])
      );
    } finally {
      process.off('SIGINT', onSigint);
    }
    return { name };
  }
}
