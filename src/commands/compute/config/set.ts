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

import {requireAppName, resolveComputeAppNameFromDir, validateName} from '../../../shared/computeApp.js';
import {resolveHerokuAppId} from '../../../shared/computeQuery.js';
import {fetchLatestReleaseVersionViaProxy, updateComputeConfigVarsViaProxy} from '../../../shared/herokuProxyApi.js';
import {PLUGIN_NAME} from '../../../shared/plugin-name.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages(PLUGIN_NAME, 'compute.config.set');

// Splits on the first = only, so a value that itself contains one (e.g. a connection string's
// query params) isn't truncated. Requires a non-empty key.
const PAIR_PATTERN = /^([^=]+)=(.*)$/v;

export type ComputeConfigSetResult = {
  configVars: Record<string, string>;
  name: string;
  release?: number;
};

export default class ConfigSet extends SfCommand<ComputeConfigSetResult> {
  public static readonly args = {
    pair: Args.string({
      multiple: true,
      summary: messages.getMessage('args.pair.summary'),
    }),
  };

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

  public async run(): Promise<ComputeConfigSetResult> {
    const {args, flags} = await this.parse(ConfigSet);
    const name = requireAppName(flags.name ?? (await resolveComputeAppNameFromDir(process.cwd())));
    validateName(name);

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
    const connection = flags['target-org'].getConnection();
    const appId = await resolveHerokuAppId(connection, name);
    this.spinner.start(`Setting config vars and restarting ${name}`);
    try {
      await updateComputeConfigVarsViaProxy(connection, {name, appId, updates});
    } catch (error) {
      this.spinner.stop('failed');
      throw error;
    }

    // Heroku's own PATCH response carries no release number, so this is a second, independent
    // call -- its failure is a best-effort miss (like display.ts's formation/release fetches),
    // not fatal to the config-set operation the spinner already reported as done.
    let release: number | undefined;
    try {
      release = await fetchLatestReleaseVersionViaProxy(connection, {name, appId});
    } catch {
      // Best-effort -- the config vars were already updated successfully above.
    }

    this.spinner.stop(release === undefined ? 'done' : `done, v${release}`);

    for (const [key, value] of Object.entries(updates)) {
      this.log(`${key}=${value}`);
    }

    return release === undefined ? {name, configVars: updates} : {name, configVars: updates, release};
  }
}
