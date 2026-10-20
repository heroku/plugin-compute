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
import {Messages} from '@salesforce/core';
import {Flags, SfCommand} from '@salesforce/sf-plugins-core';

import {
  exporterTypeForTransport,
  parseHeaderFlags,
  type TelemetryDrainResult,
  toTelemetryDrainResult,
  validateAndFormatSignals,
} from '../../../shared/computeTelemetryDrain.js';
import {updateTelemetryDrainViaProxy} from '../../../shared/herokuProxyApi.js';
import {PLUGIN_NAME} from '../../../shared/plugin-name.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages(PLUGIN_NAME, 'compute.update.telemetry-drain');

export type ComputeTelemetryDrainUpdateResult = TelemetryDrainResult;

export default class TelemetryDrainUpdate extends SfCommand<ComputeTelemetryDrainUpdateResult> {
  // No --name: the drain ID is globally unique, as in display telemetry-drain.
  public static readonly args = {
    id: Args.string({
      required: true,
      summary: messages.getMessage('args.id.summary'),
    }),
  };

  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');
  public static readonly flags = {
    url: Flags.string({summary: messages.getMessage('flags.url.summary')}),
    signals: Flags.string({summary: messages.getMessage('flags.signals.summary')}),
    // As in create: splunk is accepted but kept out of the help text.
    transport: Flags.string({summary: messages.getMessage('flags.transport.summary')}),
    header: Flags.string({
      multiple: true,
      summary: messages.getMessage('flags.header.summary'),
      description: messages.getMessage('flags.header.description'),
    }),
    'target-org': Flags.requiredOrg({char: 'o'}),
  };

  public static readonly requiresProject = false;

  public static readonly summary = messages.getMessage('summary');

  public async run(): Promise<ComputeTelemetryDrainUpdateResult> {
    const {args, flags} = await this.parse(TelemetryDrainUpdate);

    if (!flags.url && !flags.signals && !flags.transport && !flags.header) {
      throw messages.createError('error.nothingToUpdate');
    }

    // Only the attributes the user passed go on the wire (PATCH), so everything else is left as-is.
    const signals = flags.signals ? validateAndFormatSignals(flags.signals) : undefined;
    const type = flags.transport ? exporterTypeForTransport(flags.transport) : undefined;
    const headers = flags.header ? parseHeaderFlags(flags.header) : undefined;
    const endpoint = flags.url;
    const hasExporterChange = endpoint !== undefined || type !== undefined || headers !== undefined;
    const exporter = hasExporterChange ? {endpoint, type, headers} : undefined;

    const connection = flags['target-org'].getConnection();
    const drain = await updateTelemetryDrainViaProxy(connection, {drainId: args.id, signals, exporter});

    // Fall back to the requested ID if the response omits it, so --json never reports an empty id.
    const drainResult = toTelemetryDrainResult(drain);
    const result = {...drainResult, id: drainResult.id === '' ? args.id : drainResult.id};
    this.logSuccess(messages.getMessage('info.updated', [result.id]));
    return result;
  }
}
