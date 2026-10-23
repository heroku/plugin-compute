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

import {Args} from '@oclif/core';
import {type Connection, Messages} from '@salesforce/core';
import {Flags, SfCommand} from '@salesforce/sf-plugins-core';

import {findDeveloperNameByHerokuAppId} from '../../../shared/computeQuery.js';
import {formatTelemetryDrainRows, maskHeaderValues, transportLabelForExporterType} from '../../../shared/computeTelemetryDrain.js';
import {fetchTelemetryDrainViaProxy} from '../../../shared/herokuProxyApi.js';
import {PLUGIN_NAME} from '../../../shared/plugin-name.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages(PLUGIN_NAME, 'compute.display.telemetry-drain');

// Command-owned result shape (not the raw wire type) so --json stays stable across OpenAPI changes.
export type ComputeTelemetryDrainDisplayResult = {
  app: string;
  endpoint?: string;
  // `transport` collapses otlphttp and splunk to "HTTP"; the raw type is kept so --json can tell them apart.
  exporterType?: string;
  headers?: Record<string, string>;
  id: string;
  // Raw owner, so a --json consumer can tell what the `app` label collapses to (name, owner id, or space).
  ownerId?: string;
  ownerType?: 'app' | 'space';
  signals: string[];
  transport?: string;
};

export default class TelemetryDrainDisplay extends SfCommand<ComputeTelemetryDrainDisplayResult> {
  // No --name: the drain ID is globally unique and the owning app comes from the drain's own owner.
  public static readonly args = {
    id: Args.string({
      required: true,
      summary: messages.getMessage('args.id.summary'),
    }),
  };

  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');
  public static readonly flags = {
    'target-org': Flags.requiredOrg({char: 'o'}),
    'api-version': Flags.orgApiVersion(),
  };

  public static readonly requiresProject = false;

  public static readonly summary = messages.getMessage('summary');

  public async run(): Promise<ComputeTelemetryDrainDisplayResult> {
    const {args, flags} = await this.parse(TelemetryDrainDisplay);

    const connection = flags['target-org'].getConnection(flags['api-version']);
    const drain = await fetchTelemetryDrainViaProxy(connection, {drainId: args.id});
    const {app, display} = await this.resolveOwnerLabel(connection, drain.owner);

    this.styledHeader('Telemetry Drain');
    this.table({data: formatTelemetryDrainRows(drain, display), columns: ['key', 'value']});

    return {
      app,
      ownerId: drain.owner?.id,
      ownerType: drain.owner?.type,
      id: drain.id ?? args.id,
      signals: drain.signals ?? [],
      endpoint: drain.exporter?.endpoint,
      exporterType: drain.exporter?.type,
      transport: drain.exporter?.type ? transportLabelForExporterType(drain.exporter.type) : undefined,
      headers: drain.exporter?.headers === undefined ? undefined : maskHeaderValues(drain.exporter.headers),
    };
  }

  // Best-effort owning-app label from the drain's owner. For an app-owned drain it maps the Heroku
  // owner id back to the compute app's DeveloperName (the value --name accepts) through the org.
  // Returns both the machine-readable `app` -- the resolved DeveloperName, or the raw owner id when
  // the drain is space-owned, ownerless, or no compute app matches -- and the human `display`,
  // which qualifies an unresolved Heroku id so a reader can't mistake it for a compute app name.
  private async resolveOwnerLabel(
    connection: Connection,
    owner: undefined | {id?: string; type?: 'app' | 'space'},
  ): Promise<{app: string; display: string}> {
    const ownerId = owner?.id ?? '-';
    if (owner?.type !== 'app' || !owner.id) {
      return {app: ownerId, display: ownerId};
    }

    const developerName = await findDeveloperNameByHerokuAppId(connection, owner.id);
    if (developerName !== undefined) {
      return {app: developerName, display: developerName};
    }

    this.debug('no compute app resolved for Heroku app id %s; labelling App with the id', owner.id);
    return {app: owner.id, display: `${owner.id} (Heroku app id)`};
  }
}
