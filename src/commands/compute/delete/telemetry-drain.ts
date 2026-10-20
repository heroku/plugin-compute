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

import {deleteTelemetryDrainViaProxy} from '../../../shared/herokuProxyApi.js';
import {PLUGIN_NAME} from '../../../shared/plugin-name.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages(PLUGIN_NAME, 'compute.delete.telemetry-drain');

// `deleted` is false only when the user declines the interactive confirmation; under --json the prompt is skipped.
export type ComputeTelemetryDrainDeleteResult = {
  deleted: boolean;
  id: string;
};

export default class TelemetryDrainDelete extends SfCommand<ComputeTelemetryDrainDeleteResult> {
  // No --name: the drain ID is globally unique, so the app isn't needed to address it.
  public static readonly args = {
    id: Args.string({
      required: true,
      summary: messages.getMessage('args.id.summary'),
    }),
  };

  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');
  public static readonly flags = {
    'no-prompt': Flags.boolean({
      char: 'p',
      summary: messages.getMessage('flags.no-prompt.summary'),
    }),
    'target-org': Flags.requiredOrg({char: 'o'}),
  };

  public static readonly requiresProject = false;

  public static readonly summary = messages.getMessage('summary');

  public async run(): Promise<ComputeTelemetryDrainDeleteResult> {
    const {args, flags} = await this.parse(TelemetryDrainDelete);
    const drainId = args.id;

    // The prompt can't run under --json (stdout must stay valid JSON), so it's skipped there as well.
    if (!flags['no-prompt'] && !this.jsonEnabled()) {
      const isConfirmed = await this.confirm({message: messages.getMessage('info.confirm', [drainId])});
      if (!isConfirmed) {
        this.log(messages.getMessage('info.aborted', [drainId]));
        return {id: drainId, deleted: false};
      }
    }

    const connection = flags['target-org'].getConnection();
    await deleteTelemetryDrainViaProxy(connection, {drainId});

    this.logSuccess(messages.getMessage('info.deleted', [drainId]));
    return {id: drainId, deleted: true};
  }
}
