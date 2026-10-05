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

import {type ComputeAppSummary, listComputeApps, toComputeAppSummary} from '../../shared/computeQuery.js';
import {PLUGIN_NAME} from '../../shared/plugin-name.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages(PLUGIN_NAME, 'compute.list');

export type ComputeListResult = ComputeAppSummary[];

type Row = {
  masterLabel: string;
  name: string;
  status: string;
  statusReason: string;
};

function toRow(app: ComputeAppSummary): Row {
  return {
    name: app.name,
    masterLabel: app.masterLabel,
    status: app.status,
    statusReason: app.statusReason ?? '-',
  };
}

export default class List extends SfCommand<ComputeListResult> {
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');
  public static readonly flags = {
    'target-org': Flags.requiredOrg({char: 'o'}),
  };

  // Pure org-side lookup -- no local project files are read.
  public static readonly requiresProject = false;

  public static readonly summary = messages.getMessage('summary');

  public async run(): Promise<ComputeListResult> {
    const {flags} = await this.parse(List);

    const connection = flags['target-org'].getConnection();
    const records = await listComputeApps(connection);
    const results = records.map(record => toComputeAppSummary(record));

    if (results.length === 0) {
      this.info(messages.getMessage('info.noAppsFound'));
      return results;
    }

    this.styledHeader('Compute Apps');
    const data = results.map(result => toRow(result));
    const columns: Array<keyof Row> = ['name', 'masterLabel', 'status', 'statusReason'];
    this.table({data, columns});

    return results;
  }
}
