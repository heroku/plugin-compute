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
import {requireConfigVar} from '../../../shared/computeConfig.js';
import {resolveHerokuAppId} from '../../../shared/computeQuery.js';
import {
  fetchComputeConfigVarsViaProxy,
  fetchLatestReleaseVersionViaProxy,
  updateComputeConfigVarsViaProxy,
} from '../../../shared/herokuProxyApi.js';
import {PLUGIN_NAME} from '../../../shared/plugin-name.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages(PLUGIN_NAME, 'compute.unset.config');

export type ComputeConfigUnsetResult = {
  name: string;
  release?: number;
  unset: string[];
};

export default class ConfigUnset extends SfCommand<ComputeConfigUnsetResult> {
  public static readonly args = {
    key: Args.string({
      multiple: true,
      summary: messages.getMessage('args.key.summary'),
    }),
  };

  public static readonly deprecateAliases = true;
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
  };

  // Back-compat: the command was `compute config unset` before the verb-noun migration (W-24542276).
  // Kept as a hidden deprecated alias -- deprecateAliases above still prints a one-line warning
  // steering users to the new id, and the old id stays out of --help and docs/. (It stays tracked
  // in command-snapshot.json, but as its own `compute:config:unset` entry rather than in this
  // command's alias array -- see the hiddenAliases snapshot gotcha in AGENTS.md.)
  public static readonly hiddenAliases = ['compute:config:unset'];

  // Org-mediated lookup by --name -- no local project files are read.
  public static readonly requiresProject = false;

  public static readonly summary = messages.getMessage('summary');

  public async run(): Promise<ComputeConfigUnsetResult> {
    const {args, flags} = await this.parse(ConfigUnset);
    const name = requireAppName(flags.name ?? (await resolveComputeAppNameFromDir(process.cwd())));
    validateName(name);

    // A declarative `required: true`/minimum-count arg would enforce this earlier, during
    // this.parse() -- deliberately not used so the error can carry
    // error.configUnsetNoKeysSpecified's exact wording instead of oclif's generic missing-arg text.
    const tokens = args.key ?? [];
    if (tokens.length === 0) {
      throw messages.createError('error.configUnsetNoKeysSpecified');
    }

    const keys = [...new Set(tokens)];

    const connection = flags['target-org'].getConnection(flags['api-version']);
    const appId = await resolveHerokuAppId(connection, name);

    // Heroku's own PATCH is idempotent about unsetting a key that's already absent -- it
    // wouldn't error -- but the CLI UX wants a hard error for that case, so it's checked
    // client-side against a fresh fetch rather than relying on the PATCH to catch it.
    const configVars = await fetchComputeConfigVarsViaProxy(connection, {name, appId});
    for (const key of keys) {
      requireConfigVar(configVars, name, key);
    }

    const updates: Record<string, null> = {};
    for (const key of keys) {
      updates[key] = null;
    }

    this.spinner.start(`Unsetting ${keys.join(', ')} and restarting ${name}`);
    try {
      await updateComputeConfigVarsViaProxy(connection, {name, appId, updates});
    } catch (error) {
      this.spinner.stop('failed');
      throw error;
    }

    // Heroku's own PATCH response carries no release number, so this is a second, independent
    // call -- its failure is a best-effort miss (like display.ts's formation/release fetches),
    // not fatal to the config-unset operation the spinner already reported as done.
    let release: number | undefined;
    try {
      release = await fetchLatestReleaseVersionViaProxy(connection, {name, appId});
    } catch {
      // Best-effort -- the config vars were already updated successfully above.
    }

    this.spinner.stop(release === undefined ? 'done' : `done, v${release}`);

    return release === undefined ? {name, unset: keys} : {name, unset: keys, release};
  }
}
