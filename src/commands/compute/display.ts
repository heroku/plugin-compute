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
import { validateName, requireAppName, resolveComputeAppNameFromDir } from '../../shared/computeApp.js';
import { queryComputeApp, toComputeAppSummary, type ComputeAppSummary } from '../../shared/computeQuery.js';
import { getHerokuApiToken } from '../../shared/herokuApi.js';
import { fetchComputeFormationViaHeroku, type HerokuFormationSummary } from '../../shared/herokuComputeApi.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@salesforce/plugin-compute', 'compute.display');

// formation is only populated when HEROKU_API_TOKEN is set and Heroku answers -- it's a
// best-effort supplement to the org-side ComputeAppSummary fields, never a replacement for them.
export type ComputeDisplayResult = ComputeAppSummary & { formation?: HerokuFormationSummary };

export default class Display extends SfCommand<ComputeDisplayResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');
  // Pure org-side lookup by --name (DeveloperName) -- no local project files are read.
  public static readonly requiresProject = false;

  public static readonly flags = {
    name: Flags.string({
      char: 'n',
      env: 'COMPUTE_APP_NAME',
      summary: messages.getMessage('flags.name.summary'),
    }),
    'target-org': Flags.requiredOrg({ char: 'o' }),
    verbose: Flags.boolean({
      char: 'v',
      summary: messages.getMessage('flags.verbose.summary'),
    }),
  };

  public async run(): Promise<ComputeDisplayResult> {
    const { flags } = await this.parse(Display);
    const name = requireAppName(flags.name ?? (await resolveComputeAppNameFromDir(process.cwd())));
    validateName(name);

    const connection = flags['target-org'].getConnection();
    const record = await queryComputeApp(connection, name);
    const result = toComputeAppSummary(record);

    let formation: HerokuFormationSummary | undefined;
    const herokuToken = getHerokuApiToken();
    if (herokuToken) {
      try {
        formation = await fetchComputeFormationViaHeroku(herokuToken, { name });
      } catch (err) {
        this.warn(messages.getMessage('warning.herokuFormationUnavailable', [(err as Error).message]));
      }
    }

    this.styledHeader('Compute App');
    this.table({
      data: [
        { key: 'Compute App Name', value: result.name },
        { key: 'Master Label', value: result.masterLabel },
        { key: 'Description', value: result.description ?? '-' },
        { key: 'Status', value: result.status },
        { key: 'Status Reason', value: result.statusReason ?? '-' },
      ],
      columns: ['key', 'value'],
    });

    if (formation && formation.length > 0) {
      this.log('');
      this.styledHeader('Dyno Formation');
      this.table({
        data: formation.map((f) => ({ type: f.type, dynoSize: f.dynoSize ?? '-', quantity: f.quantity })),
        columns: ['type', 'dynoSize', 'quantity'],
      });
    }

    if (flags.verbose) {
      this.log('');
      this.styledHeader('External Service');
      this.table({
        data: [
          { key: 'Registered', value: result.externalServiceRegistered ? 'yes' : 'no' },
          { key: 'Active', value: result.externalServiceActive ? 'yes' : 'no' },
        ],
        columns: ['key', 'value'],
      });

      if (result.currentBuild) {
        this.log('');
        this.styledHeader('Current Build');
        this.table({
          data: [
            { key: 'Build Status', value: result.currentBuild.buildStatus },
            { key: 'Build Started', value: result.currentBuild.buildStartedAt ?? '-' },
            { key: 'Build Completed', value: result.currentBuild.buildCompletedAt ?? '-' },
            { key: 'Deployed At', value: result.currentBuild.deployedAt ?? '-' },
            { key: 'Deployed By', value: result.currentBuild.deployedBy ?? '-' },
            { key: 'Error', value: result.currentBuild.error ?? '-' },
          ],
          columns: ['key', 'value'],
        });
      }
    }

    return { ...result, formation };
  }
}
