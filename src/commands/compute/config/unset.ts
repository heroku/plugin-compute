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
import { requireConfigVar } from '../../../shared/computeConfig.js';
import {
  fetchComputeConfigVarsViaProxy,
  updateComputeConfigVarsViaProxy,
  fetchLatestReleaseVersionViaProxy,
} from '../../../shared/herokuProxyApi.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@salesforce/plugin-compute', 'compute.config.unset');

export type ComputeConfigUnsetResult = {
  name: string;
  unset: string[];
  release?: number;
};

export default class ConfigUnset extends SfCommand<ComputeConfigUnsetResult> {
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

  public async run(): Promise<ComputeConfigUnsetResult> {
    const { args, flags } = await this.parse(ConfigUnset);
    const name = requireAppName(flags.name ?? (await resolveComputeAppNameFromDir(process.cwd())));

    // A declarative `required: true`/minimum-count arg would enforce this earlier, during
    // this.parse() -- deliberately not used so the error can carry
    // error.configUnsetNoKeysSpecified's exact wording instead of oclif's generic missing-arg text.
    const tokens = args.key ?? [];
    if (tokens.length === 0) {
      throw messages.createError('error.configUnsetNoKeysSpecified');
    }
    const keys = [...new Set(tokens)];

    // --name is never interpolated into SOQL (unlike display.ts/list.ts) -- the proxy path below
    // URL-encodes it as a REST path segment, and a PlatformComputeApp Id/DeveloperName and a
    // Heroku app Id/name (conventionally hyphenated) must both pass through untouched -- so this
    // skips validateName, matching scale.ts.
    const connection = flags['target-org'].getConnection();

    // Heroku's own PATCH is idempotent about unsetting a key that's already absent -- it
    // wouldn't error -- but the CLI UX wants a hard error for that case, so it's checked
    // client-side against a fresh fetch rather than relying on the PATCH to catch it.
    const configVars = await fetchComputeConfigVarsViaProxy(connection, { name });
    for (const key of keys) {
      requireConfigVar(configVars, name, key);
    }

    const updates: Record<string, null> = {};
    for (const key of keys) {
      updates[key] = null;
    }

    this.spinner.start(`Unsetting ${keys.join(', ')} and restarting ${name}`);
    try {
      await updateComputeConfigVarsViaProxy(connection, { name, updates });
    } catch (err) {
      this.spinner.stop('failed');
      throw err;
    }

    // Heroku's own PATCH response carries no release number, so this is a second, independent
    // call -- its failure is a best-effort miss (like display.ts's formation/release fetches),
    // not fatal to the config-unset operation the spinner already reported as done.
    let release: number | undefined;
    try {
      release = await fetchLatestReleaseVersionViaProxy(connection, { name });
    } catch {
      // Best-effort -- the config vars were already updated successfully above.
    }
    this.spinner.stop(release === undefined ? 'done' : `done, v${release}`);

    return release === undefined ? { name, unset: keys } : { name, unset: keys, release };
  }
}
