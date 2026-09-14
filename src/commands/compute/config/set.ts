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
import { requireAppName, resolveComputeAppNameFromDir } from '../../../shared/computeApp.js';
import { updateComputeConfigVars } from '../../../shared/computeConnectApi.js';
import { getHerokuApiToken } from '../../../shared/herokuApi.js';
import { updateComputeConfigVarsViaHeroku } from '../../../shared/herokuComputeApi.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@salesforce/plugin-compute', 'compute.config.set');

// Splits on the first = only, so a value that itself contains one (e.g. a connection string's
// query params) isn't truncated. Requires a non-empty key.
const PAIR_PATTERN = /^([^=]+)=(.*)$/;

export type ComputeConfigSetResult = {
  name: string;
  configVars: Record<string, string>;
  release?: number;
};

export default class ConfigSet extends SfCommand<ComputeConfigSetResult> {
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');
  // Org-mediated lookup by --name -- no local project files are read.
  public static readonly requiresProject = false;

  public static readonly args = {
    pair: Args.string({
      multiple: true,
      summary: messages.getMessage('args.pair.summary'),
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

  public async run(): Promise<ComputeConfigSetResult> {
    const { args, flags } = await this.parse(ConfigSet);
    const name = requireAppName(flags.name ?? (await resolveComputeAppNameFromDir(process.cwd())));

    // --name is never interpolated into SOQL (unlike display.ts/list.ts) -- both the Connect and
    // Heroku-direct paths below URL-encode it as a REST path segment, and a PlatformComputeApp
    // Id/DeveloperName and a Heroku app Id/name (conventionally hyphenated) must both pass
    // through untouched -- so this skips validateName, matching scale.ts.

    // A declarative `required: true`/minimum-count arg would enforce this earlier, during
    // this.parse() -- deliberately not used so the error can carry
    // error.configSetNoPairsSpecified's exact wording instead of oclif's generic missing-arg text.
    const tokens = args.pair ?? [];
    if (tokens.length === 0) {
      throw messages.createError('error.configSetNoPairsSpecified');
    }

    // Plain-object insertion order both dedupes a key set twice in one invocation (last value
    // wins, at its first-occurrence position) and gives the echo below the order the user typed.
    const updates: Record<string, string> = {};
    for (const token of tokens) {
      const match = PAIR_PATTERN.exec(token);
      if (!match) {
        throw messages.createError('error.configSetInvalidPair', [token, token]);
      }
      const [, key, value] = match;
      updates[key] = value;
    }

    // No existence check first, unlike get/unset -- set is also how a brand-new config var gets
    // created, so a nonexistent key here isn't an error, it's the normal creation path.
    const herokuToken = getHerokuApiToken();
    this.spinner.start(`Setting config vars and restarting ${name}`);
    let release: number | undefined;
    try {
      if (herokuToken) {
        // Heroku's own PATCH response carries no release number -- see
        // updateComputeConfigVarsViaHeroku's comment in herokuComputeApi.ts.
        await updateComputeConfigVarsViaHeroku(herokuToken, { name, updates });
      } else {
        const result = await updateComputeConfigVars(flags['target-org'].getConnection(), { app: name, updates });
        release = result.release;
      }
    } catch (err) {
      this.spinner.stop('failed');
      throw err;
    }
    this.spinner.stop(release === undefined ? 'done' : `done, v${release}`);

    for (const key of Object.keys(updates)) {
      this.log(`${key}=${updates[key]}`);
    }

    return release === undefined ? { name, configVars: updates } : { name, configVars: updates, release };
  }
}
