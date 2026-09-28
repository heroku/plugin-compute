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
import { validateName, requireAppName, resolveComputeAppNameFromDir } from '../../shared/computeApp.js';
import { resolveHerokuAppId } from '../../shared/computeQuery.js';
import { scaleComputeFormationViaProxy } from '../../shared/herokuProxyApi.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@salesforce/plugin-compute', 'compute.scale');

// Matches Heroku's own `heroku ps:scale` target syntax: TYPE[=COUNT][:SIZE]. TYPE follows
// Heroku's process-type pattern (salesforce-connect-compute.yaml's Formation.type: ^[-\w]{1,128}$).
// The SIZE group additionally allows `.` (unlike TYPE/COUNT) because Fir's Classic-family dyno
// sizes use fractional GB, e.g. dyno-1c-0.5gb.
const TARGET_PATTERN = /^([-\w]+)(?:=(\d+))?(?::([-\w.]+))?$/;

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
    validateName(name);

    // A declarative `required: true`/minimum-count arg would enforce this earlier, during
    // this.parse() -- deliberately not used so the error can carry
    // error.scaleNoTargetsSpecified's exact wording instead of oclif's generic missing-arg text.
    const tokens = args.target ?? [];
    if (tokens.length === 0) {
      throw messages.createError('error.scaleNoTargetsSpecified');
    }
    const targets = tokens.map((token) => parseScaleTarget(token));

    const connection = flags['target-org'].getConnection();
    const appId = await resolveHerokuAppId(connection, name);

    this.spinner.start('Scaling dynos');
    const formation: Array<{ type: string; dynoSize?: string; quantity: number }> = [];
    try {
      for (const target of targets) {
        // Sequential PATCHes to the same app's formation -- there's nothing to parallelize.
        /* eslint-disable no-await-in-loop */
        const updated = await scaleComputeFormationViaProxy(connection, { name, appId, ...target });
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
