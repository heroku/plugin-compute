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
import {formatConfigVarLines} from '../../shared/computeConfig.js';
import {resolveHerokuAppId} from '../../shared/computeQuery.js';
import {fetchComputeConfigVarsViaProxy} from '../../shared/herokuProxyApi.js';
import {PLUGIN_NAME} from '../../shared/plugin-name.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages(PLUGIN_NAME, 'compute.config');

export type ComputeConfigResult = {
  configVars: Record<string, string>;
  name: string;
};

export default class Config extends SfCommand<ComputeConfigResult> {
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

  public async run(): Promise<ComputeConfigResult> {
    const {flags} = await this.parse(Config);
    const name = requireAppName(flags.name ?? (await resolveComputeAppNameFromDir(process.cwd())));
    validateName(name);

    const connection = flags['target-org'].getConnection();
    const appId = await resolveHerokuAppId(connection, name);
    const fetched = await fetchComputeConfigVarsViaProxy(connection, {name, appId});

    const configVars: Record<string, string> = {};
    for (const key of Object.keys(fetched).toSorted()) {
      configVars[key] = fetched[key];
    }

    this.styledHeader(`${name} Config Vars`);
    for (const line of formatConfigVarLines(configVars)) {
      this.log(line);
    }

    return {name, configVars};
  }
}
