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
import {SfCommand} from '@salesforce/sf-plugins-core';

import {PLUGIN_NAME} from '../../shared/plugin-name.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages(PLUGIN_NAME, 'compute.deploy');

export type ComputeDeployResult = {
  message: string;
};

export default class Deploy extends SfCommand<ComputeDeployResult> {
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');
  public static readonly requiresProject = false;
  public static readonly summary = messages.getMessage('summary');

  public async run(): Promise<ComputeDeployResult> {
    await this.parse(Deploy);
    const message = messages.getMessage('warning.migrate');
    this.warn(message);
    return {message};
  }
}
