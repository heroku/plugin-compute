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
import { requireAppName, resolveComputeAppNameFromDir } from '../../shared/computeApp.js';
import { updateComputeFormation } from '../../shared/computeConnectApi.js';
import { getHerokuApiToken } from '../../shared/herokuApi.js';
import { scaleComputeFormationViaHeroku } from '../../shared/herokuComputeApi.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@salesforce/plugin-compute', 'compute.scale');

// Matches Heroku's own `heroku ps:scale` target syntax: TYPE[=COUNT][:SIZE]. TYPE follows
// Heroku's process-type pattern (salesforce-connect-compute.yaml's Formation.type: ^[-\w]{1,128}$).
const TARGET_PATTERN = /^([-\w]+)(?:=(\d+))?(?::([-\w]+))?$/;

// Closed enum per the CLI UX spec -- validated client-side so a typo surfaces immediately with
// the full valid list, instead of round-tripping to the org/Heroku first.
const VALID_SIZES = ['eco', 'basic', 'standard-1x', 'standard-2x', 'performance-m', 'performance-l'];

type ScaleTarget = { processType: string; quantity?: number; dynoSize?: string };

function parseScaleTarget(token: string): ScaleTarget {
  const match = TARGET_PATTERN.exec(token);
  if (!match) {
    throw messages.createError('error.scaleInvalidTarget', [token]);
  }
  const [, processType, countStr, sizeStr] = match;
  if (countStr === undefined && sizeStr === undefined) {
    throw messages.createError('error.scaleNoChangeForTarget', [token]);
  }
  let dynoSize: string | undefined;
  if (sizeStr !== undefined) {
    dynoSize = sizeStr.toLowerCase();
    if (!VALID_SIZES.includes(dynoSize)) {
      throw messages.createError('error.scaleInvalidSize', [sizeStr, VALID_SIZES.join(', ')]);
    }
  }
  return { processType, quantity: countStr === undefined ? undefined : Number(countStr), dynoSize };
}

export type ComputeScaleResult = {
  name: string;
  formation: Array<{ type: string; dynoSize?: string; quantity: number }>;
};

export default class Scale extends SfCommand<ComputeScaleResult> {
  public static readonly state = 'beta';
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');
  // Org- or Heroku-mediated lookup by --name -- no local project files are read.
  public static readonly requiresProject = false;

  public static readonly args = {
    target: Args.string({
      multiple: true,
      summary: messages.getMessage('args.target.summary'),
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

  public async run(): Promise<ComputeScaleResult> {
    const { args, flags } = await this.parse(Scale);
    const name = requireAppName(flags.name ?? (await resolveComputeAppNameFromDir(process.cwd())));

    // --name is never joined into a filesystem path or interpolated into SOQL (unlike other
    // commands' --name), so it skips validateName -- the Connect and Heroku-direct paths below
    // each URL-encode it as a REST path segment, and both a PlatformComputeApp Id/DeveloperName
    // and a Heroku app Id (a UUID, hyphens included) or name (conventionally hyphenated) must
    // pass through untouched.

    // A declarative `required: true`/minimum-count arg would enforce this earlier, during
    // this.parse() -- deliberately not used so the error can carry
    // error.scaleNoTargetsSpecified's exact wording instead of oclif's generic missing-arg text.
    const tokens = args.target ?? [];
    if (tokens.length === 0) {
      throw messages.createError('error.scaleNoTargetsSpecified');
    }
    const targets = tokens.map((token) => parseScaleTarget(token));

    // Connect API (org-mediated) is the default, matching display/logs/build output --
    // HEROKU_API_TOKEN switches to calling Heroku directly instead, using --name as the Heroku
    // app Id/name rather than the PlatformComputeApp Id/DeveloperName the Connect resource
    // resolves. One call per target process type either way -- Heroku's own per-type Update
    // Formation API (and the Connect resource mirroring it) takes a dyno size by name, unlike
    // its batch formation endpoint, which only accepts a dyno size Id the CLI never has.
    const herokuToken = getHerokuApiToken();

    this.spinner.start('Scaling dynos');
    const formation: Array<{ type: string; dynoSize?: string; quantity: number }> = [];
    try {
      for (const target of targets) {
        // Sequential PATCHes to the same app's formation -- there's nothing to parallelize.
        /* eslint-disable no-await-in-loop */
        const updated = herokuToken
          ? await scaleComputeFormationViaHeroku(herokuToken, { name, ...target })
          : await updateComputeFormation(flags['target-org'].getConnection(), { app: name, ...target });
        /* eslint-enable no-await-in-loop */
        formation.push(updated);
      }
    } catch (err) {
      this.spinner.stop('failed');
      throw err;
    }

    const summary = formation.map((f) => `${f.type} at ${f.quantity}:${f.dynoSize ?? '-'}`).join(', ');
    this.spinner.stop(`done, now running ${summary}.`);

    return { name, formation };
  }
}
