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

import {requireAppName, resolveComputeAppNameFromDir, validateName} from '../../shared/computeApp.js';
import {resolveHerokuAppId} from '../../shared/computeQuery.js';
import {scaleComputeFormationViaProxy} from '../../shared/herokuProxyApi.js';
import {PLUGIN_NAME} from '../../shared/plugin-name.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages(PLUGIN_NAME, 'compute.scale');

// Heroku's process-type pattern (salesforce-connect-compute.yaml's Formation.type: ^[-\w]{1,128}$).
const PROCESS_TYPE_PATTERN = /^[\-\w]{1,128}$/v;

// Fir dyno-size identifiers (dyno-<vCPUs>c-<RAM>gb). Full union of all 4 Fir dyno families --
// product hasn't yet decided which families Compute apps may provision on for GA, so this is a
// deliberately permissive default, not a final allow-list. Narrow once that's decided.
const VALID_SIZES = [
  // Classic
  'dyno-1c-0.5gb',
  'dyno-2c-1gb',
  // General Purpose
  'dyno-1c-4gb',
  'dyno-2c-8gb',
  'dyno-4c-16gb',
  'dyno-8c-32gb',
  'dyno-16c-64gb',
  // Compute
  'dyno-2c-4gb',
  'dyno-4c-8gb',
  'dyno-8c-16gb',
  'dyno-16c-32gb',
  'dyno-32c-64gb',
  // Memory
  'dyno-1c-8gb',
  'dyno-2c-16gb',
  'dyno-4c-32gb',
  'dyno-8c-64gb',
  'dyno-16c-128gb',
];

export type ComputeScaleResult = {
  formation: Array<{dynoSize?: string; quantity: number; type: string}>;
  name: string;
};

export default class Scale extends SfCommand<ComputeScaleResult> {
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');
  public static readonly flags = {
    name: Flags.string({
      char: 'n',
      env: 'COMPUTE_APP_NAME',
      summary: messages.getMessage('flags.name.summary'),
    }),
    'target-org': Flags.requiredOrg({char: 'o'}),
    'api-version': Flags.orgApiVersion(),
    'process-type': Flags.string({
      required: true,
      summary: messages.getMessage('flags.process-type.summary'),
    }),
    quantity: Flags.integer({
      min: 0,
      summary: messages.getMessage('flags.quantity.summary'),
    }),
    size: Flags.string({
      summary: messages.getMessage('flags.size.summary'),
    }),
  };

  // Org- or Heroku-mediated lookup by --name -- no local project files are read.
  public static readonly requiresProject = false;

  public static readonly summary = messages.getMessage('summary');

  public async run(): Promise<ComputeScaleResult> {
    const {flags} = await this.parse(Scale);
    const name = requireAppName(flags.name ?? (await resolveComputeAppNameFromDir(process.cwd())));
    validateName(name);

    const processType = flags['process-type'];
    if (!PROCESS_TYPE_PATTERN.test(processType)) {
      throw messages.createError('error.scaleInvalidProcessType', [processType]);
    }

    const {quantity} = flags;
    if (quantity === undefined && flags.size === undefined) {
      throw messages.createError('error.scaleNoChange', [processType]);
    }

    let dynoSize: string | undefined;
    if (flags.size !== undefined) {
      dynoSize = flags.size.toLowerCase();
      if (!VALID_SIZES.includes(dynoSize)) {
        throw messages.createError('error.scaleInvalidSize', [flags.size, VALID_SIZES.join(', ')]);
      }
    }

    const connection = flags['target-org'].getConnection(flags['api-version']);
    const appId = await resolveHerokuAppId(connection, name);

    this.spinner.start('Scaling dynos');
    try {
      const updated = await scaleComputeFormationViaProxy(connection, {
        name, appId, processType, quantity, dynoSize,
      });
      this.spinner.stop(`done, now running ${updated.type} at ${updated.quantity}:${updated.dynoSize ?? '-'}.`);
      return {name, formation: [updated]};
    } catch (error) {
      this.spinner.stop('failed');
      throw error;
    }
  }
}
