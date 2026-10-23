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
import {
  exporterTypeForTransport,
  parseHeaderFlags,
  type TelemetryDrainResult,
  toTelemetryDrainResult,
  validateAndFormatSignals,
} from '../../../shared/computeTelemetryDrain.js';
import {createTelemetryDrainViaProxy} from '../../../shared/herokuProxyApi.js';
import {PLUGIN_NAME} from '../../../shared/plugin-name.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages(PLUGIN_NAME, 'compute.create.telemetry-drain');

export type ComputeTelemetryDrainCreateResult = TelemetryDrainResult & {app: string};

export default class TelemetryDrainCreate extends SfCommand<ComputeTelemetryDrainCreateResult> {
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');
  public static readonly flags = {
    name: Flags.string({
      char: 'n',
      env: 'COMPUTE_APP_NAME',
      summary: messages.getMessage('flags.name.summary'),
    }),
    url: Flags.string({
      required: true,
      summary: messages.getMessage('flags.url.summary'),
    }),
    signals: Flags.string({
      summary: messages.getMessage('flags.signals.summary'),
      default: 'all',
    }),
    // splunk is accepted by exporterTypeForTransport but deliberately left out of `options` and the
    // help text: http and grpc are the public transports, splunk stays hidden.
    transport: Flags.string({
      summary: messages.getMessage('flags.transport.summary'),
      default: 'http',
    }),
    header: Flags.string({
      multiple: true,
      summary: messages.getMessage('flags.header.summary'),
      description: messages.getMessage('flags.header.description'),
    }),
    'target-org': Flags.requiredOrg({char: 'o'}),
    'api-version': Flags.orgApiVersion(),
  };

  // Org-mediated lookup by --name -- no local project files are read.
  public static readonly requiresProject = false;

  public static readonly summary = messages.getMessage('summary');

  public async run(): Promise<ComputeTelemetryDrainCreateResult> {
    const {flags} = await this.parse(TelemetryDrainCreate);
    const name = requireAppName(flags.name ?? (await resolveComputeAppNameFromDir(process.cwd())));
    validateName(name);

    // Validate every input before the first network call so a typo never costs a round trip.
    const signals = validateAndFormatSignals(flags.signals);
    const exporterType = exporterTypeForTransport(flags.transport);
    const headers = flags.header ? parseHeaderFlags(flags.header) : undefined;

    const connection = flags['target-org'].getConnection(flags['api-version']);
    const appId = await resolveHerokuAppId(connection, name);
    const drain = await createTelemetryDrainViaProxy(connection, {
      appId,
      name,
      endpoint: flags.url,
      exporterType,
      signals,
      headers,
    });

    const result = {app: name, ...toTelemetryDrainResult(drain)};
    this.logSuccess(messages.getMessage('info.created', [result.id, name]));
    return result;
  }
}
