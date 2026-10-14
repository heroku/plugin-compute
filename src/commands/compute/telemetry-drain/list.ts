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
import {resolveHerokuAppId} from '../../../shared/computeQuery.js';
import {listTelemetryDrainsViaProxy} from '../../../shared/herokuProxyApi.js';
import {PLUGIN_NAME} from '../../../shared/plugin-name.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages(PLUGIN_NAME, 'compute.telemetry-drain.list');

// Dash placeholder for an empty table cell -- matches the other compute tables (see display.ts).
const DASH = '-';

// Structured per-drain result: signals stays a string[] and endpoint stays optional so --json isn't
// lossy. The table cells join/dash these for display only (see toRow), mirroring the list.ts/display.ts
// split where the rendered subset never flattens the returned result.
export type ComputeTelemetryDrainListResult = {
  drains: Array<{endpoint?: string; id?: string; signals: string[]}>;
  name: string;
};

type Row = {endpoint: string; id: string; signals: string};

function toRow(drain: ComputeTelemetryDrainListResult['drains'][number]): Row {
  return {
    id: drain.id ?? DASH,
    signals: drain.signals.length > 0 ? drain.signals.join(', ') : DASH,
    endpoint: drain.endpoint ?? DASH,
  };
}

export default class TelemetryDrainList extends SfCommand<ComputeTelemetryDrainListResult> {
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');
  public static readonly flags = {
    name: Flags.string({
      char: 'n',
      env: 'COMPUTE_APP_NAME',
      summary: messages.getMessage('flags.name.summary'),
    }),
    'target-org': Flags.requiredOrg({char: 'o'}),
  };

  // Org-mediated lookup by --name -- no local project files are read.
  public static readonly requiresProject = false;

  public static readonly summary = messages.getMessage('summary');

  public async run(): Promise<ComputeTelemetryDrainListResult> {
    const {flags} = await this.parse(TelemetryDrainList);
    const name = requireAppName(flags.name ?? (await resolveComputeAppNameFromDir(process.cwd())));
    validateName(name);

    const connection = flags['target-org'].getConnection();
    const appId = await resolveHerokuAppId(connection, name);
    const fetched = await listTelemetryDrainsViaProxy(connection, {name, appId});

    // Heroku returns drains in its own order; preserve it rather than imposing a client-side sort.
    const drains = fetched.map(drain => ({
      id: drain.id,
      signals: drain.signals ?? [],
      endpoint: drain.exporter?.endpoint,
    }));

    if (drains.length === 0) {
      this.info(messages.getMessage('info.noDrainsFound', [name]));
      return {name, drains};
    }

    this.styledHeader(`${name} Telemetry Drains`);
    const data = drains.map(drain => toRow(drain));
    const columns: Array<keyof Row> = ['id', 'signals', 'endpoint'];
    this.table({data, columns});

    return {name, drains};
  }
}
