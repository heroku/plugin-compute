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
const messages = Messages.loadMessages(PLUGIN_NAME, 'compute.telemetry-drain.get');

// Mapped, command-owned result (not the raw generated TelemetryDrain wire type): keeps the --json
// contract from silently tracking OpenAPI spec drift, and keeps bin/dev.js schema generate from
// pinning a loose all-optional wire shape (see the HerokuFormationUpdate note in herokuProxyApi.ts).
export type ComputeTelemetryDrainGetResult = {
  app: string;
  endpoint?: string;
  headers?: Record<string, string>;
  id: string;
  signals: string[];
  transport?: string;
};

export default class TelemetryDrainGet extends SfCommand<ComputeTelemetryDrainGetResult> {
  // The drain ID globally identifies the drain (fetchTelemetryDrainViaProxy takes only the id), so
  // this command takes no --name: trusting a caller-passed app name is exactly the mismatch the
  // PR #35 review flagged. The owning app is derived from the drain's own owner below.
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

  // Pure drain-id lookup -- no local project files are read.
  public static readonly requiresProject = false;

  public static readonly summary = messages.getMessage('summary');

  public async run(): Promise<ComputeTelemetryDrainGetResult> {
    const {args, flags} = await this.parse(TelemetryDrainGet);

    const connection = flags['target-org'].getConnection();
    const drain = await fetchTelemetryDrainViaProxy(connection, {drainId: args.id});
    const app = await this.resolveOwnerLabel(connection, drain.owner);

    this.styledHeader('Telemetry Drain');
    this.table({data: formatTelemetryDrainRows(drain, app), columns: ['key', 'value']});

    return {
      app,
      id: drain.id ?? args.id,
      signals: drain.signals ?? [],
      endpoint: drain.exporter?.endpoint,
      transport: drain.exporter?.type ? transportLabelForExporterType(drain.exporter.type) : undefined,
      headers: drain.exporter?.headers,
    };
  }

  // Derives the drain's owning app label from the drain's own owner, never from a caller-passed name
  // (PR #35). Best-effort: fetchComputeAppViaProxy throws on any proxy error, but the drain is the
  // primary payload and is already in hand, so a failed/absent label lookup falls back to the owner
  // id rather than failing the whole command (mirrors display.ts's non-fatal Heroku supplements).
  // Compute is app-only; a space-owned drain is out of scope, so its label is just the owner id.
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
    } catch {
      return owner.id;
    }
  }
}
