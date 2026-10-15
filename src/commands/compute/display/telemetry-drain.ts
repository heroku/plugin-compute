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

import {formatTelemetryDrainRows, transportLabelForExporterType} from '../../../shared/computeTelemetryDrain.js';
import {fetchComputeAppViaProxy, fetchTelemetryDrainViaProxy} from '../../../shared/herokuProxyApi.js';
import {PLUGIN_NAME} from '../../../shared/plugin-name.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages(PLUGIN_NAME, 'compute.display.telemetry-drain');

// Command-owned result shape (not the raw wire type) so --json stays stable across OpenAPI changes.
export type ComputeTelemetryDrainDisplayResult = {
  app: string;
  endpoint?: string;
  // `transport` collapses otlphttp and splunk to "HTTP"; the raw type is kept so --json can tell them apart.
  exporterType?: string;
  // Returned verbatim; the human table masks the values, which can carry credentials.
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
  };

  public static readonly requiresProject = false;

  public static readonly summary = messages.getMessage('summary');

  public async run(): Promise<ComputeTelemetryDrainDisplayResult> {
    const {args, flags} = await this.parse(TelemetryDrainDisplay);

    const connection = flags['target-org'].getConnection();
    const drain = await fetchTelemetryDrainViaProxy(connection, {drainId: args.id});
    const app = await this.resolveOwnerLabel(connection, drain.owner);

    this.styledHeader('Telemetry Drain');
    this.table({data: formatTelemetryDrainRows(drain, app), columns: ['key', 'value']});

    return {
      app,
      ownerId: drain.owner?.id,
      ownerType: drain.owner?.type,
      id: drain.id ?? args.id,
      signals: drain.signals ?? [],
      endpoint: drain.exporter?.endpoint,
      exporterType: drain.exporter?.type,
      transport: drain.exporter?.type ? transportLabelForExporterType(drain.exporter.type) : undefined,
      headers: drain.exporter?.headers,
    };
  }

  // Best-effort owning-app label from the drain's owner; falls back to the owner id if the lookup
  // fails or the drain is space-owned (out of app-only scope).
  private async resolveOwnerLabel(
    connection: Connection,
    owner: undefined | {id?: string; type?: 'app' | 'space'},
  ): Promise<string> {
    const ownerId = owner?.id ?? '-';
    if (owner?.type !== 'app' || !owner.id) {
      return ownerId;
    }

    try {
      const summary = await fetchComputeAppViaProxy(connection, {name: owner.id, appId: owner.id});
      return summary?.name ?? owner.id;
    } catch (error) {
      this.debug('owner label lookup failed for %s: %s', owner.id, error instanceof Error ? error.message : String(error));
      return owner.id;
    }
  }
}
