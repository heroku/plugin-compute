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

import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Args } from '@oclif/core';
import { Messages } from '@salesforce/core';
import { validateName, requireAppName, resolveComputeAppNameFromDir } from '../../../shared/computeApp.js';
import { fetchComputeConfigVars } from '../../../shared/computeConnectApi.js';
import { formatConfigVarLines, requireConfigVar } from '../../../shared/computeConfig.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@salesforce/plugin-compute', 'compute.config.get');

export type ComputeConfigGetResult = {
  name: string;
  values: Record<string, string>;
};

export default class ConfigGet extends SfCommand<ComputeConfigGetResult> {
  public static readonly state = 'beta';
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');
  // Org-mediated lookup by --name -- no local project files are read.
  public static readonly requiresProject = false;

  public static readonly args = {
    key: Args.string({
      multiple: true,
      summary: messages.getMessage('args.key.summary'),
    }),
  };

  public static readonly flags = {
    name: Flags.string({
      char: 'n',
      env: 'COMPUTE_APP_NAME',
      summary: messages.getMessage('flags.name.summary'),
    }),
    'target-org': Flags.requiredOrg({ char: 'o' }),
  };

  public async run(): Promise<ComputeConfigGetResult> {
    const { args, flags } = await this.parse(ConfigGet);
    const name = requireAppName(flags.name ?? (await resolveComputeAppNameFromDir(process.cwd())));
    // Unlike scale.ts's --name, config has no Heroku-direct escape hatch to hedge against, so
    // --name is always a PlatformComputeApp Id/DeveloperName, never a hyphenated Heroku app name.
    validateName(name);

    // A declarative `required: true`/minimum-count arg would enforce this earlier, during
    // this.parse() -- deliberately not used so the error can carry
    // error.configGetNoKeysSpecified's exact wording instead of oclif's generic missing-arg text.
    const tokens = args.key ?? [];
    if (tokens.length === 0) {
      throw messages.createError('error.configGetNoKeysSpecified');
    }
    const keys = [...new Set(tokens)];

    const connection = flags['target-org'].getConnection();
    const configVars = await fetchComputeConfigVars(connection, { app: name });

    const values: Record<string, string> = {};
    for (const key of keys) {
      values[key] = requireConfigVar(configVars, name, key);
    }

    if (keys.length === 1) {
      this.log(values[keys[0]]);
    } else {
      for (const line of formatConfigVarLines(values)) {
        this.log(line);
      }
    }

    return { name, values };
  }
}
