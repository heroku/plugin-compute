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
import {
  type ComputeAppSummary,
  pickHerokuAppId,
  queryComputeApp,
  toComputeAppSummary,
} from '../../shared/computeQuery.js';
import {
  fetchComputeFormationViaProxy,
  fetchLatestReleaseVersionViaProxy,
  type HerokuFormationSummary,
} from '../../shared/herokuProxyApi.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@salesforce/plugin-compute', 'compute.display');

// formation/release are best-effort supplements to the org-side ComputeAppSummary fields, fetched
// from Heroku via the Salesforce proxy -- never a replacement for the org-side fields, and never
// fatal to the command if either fetch fails.
export type ComputeDisplayResult = ComputeAppSummary & {
  formation?: HerokuFormationSummary;
  orgId: string;
  release?: number;
};

// Heroku's own TYPE=COUNT[:SIZE] scale-target shape (see `sf compute scale`), reused here to
// render the Formation row -- e.g. "web=1:eco", or "web=2, worker=1:standard-1x" for multiple.
function formatFormation(formation: HerokuFormationSummary | undefined): string {
  if (!formation || formation.length === 0) {
    return '-';
  }

  return formation.map(f => `${f.type}=${f.quantity}${f.dynoSize ? `:${f.dynoSize}` : ''}`).join(', ');
}

function formatBuildDuration(startedAt?: string, completedAt?: string): string {
  if (!startedAt || !completedAt) {
    return '-';
  }

  const totalSeconds = Math.round((new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 1000);
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return '-';
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export default class Display extends SfCommand<ComputeDisplayResult> {
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');
  public static readonly flags = {
    name: Flags.string({
      char: 'n',
      env: 'COMPUTE_APP_NAME',
      summary: messages.getMessage('flags.name.summary'),
    }),
    'target-org': Flags.requiredOrg({char: 'o'}),
    verbose: Flags.boolean({
      char: 'v',
      summary: messages.getMessage('flags.verbose.summary'),
    }),
  };

  // Pure org-side lookup by --name (DeveloperName) -- no local project files are read.
  public static readonly requiresProject = false;

  public static readonly summary = messages.getMessage('summary');

  public async run(): Promise<ComputeDisplayResult> {
    const {flags} = await this.parse(Display);
    const name = requireAppName(flags.name ?? (await resolveComputeAppNameFromDir(process.cwd())));
    validateName(name);

    const connection = flags['target-org'].getConnection();
    const record = await queryComputeApp(connection, name);
    const result = toComputeAppSummary(record);
    const orgId = flags['target-org'].getOrgId();
    const appId = pickHerokuAppId(record);

    // No Heroku app id yet (no successful build) -- skip both proxy calls entirely and let the
    // Heroku App table render its placeholder dashes below, same as the unsourced App Name/Region
    // rows. Not a warning-worthy condition: it's the expected state for a brand-new app.
    let formation: HerokuFormationSummary | undefined;
    let release: number | undefined;
    if (appId) {
      // Independent try/catch blocks -- a release-fetch failure must never blank out formation
      // display, and vice versa.
      try {
        formation = await fetchComputeFormationViaProxy(connection, {name, appId});
      } catch (error) {
        this.warn(messages.getMessage('warning.herokuFormationUnavailable', [(error as Error).message]));
      }

      try {
        release = await fetchLatestReleaseVersionViaProxy(connection, {name, appId});
      } catch (error) {
        this.warn(messages.getMessage('warning.herokuReleaseUnavailable', [(error as Error).message]));
      }
    }

    this.renderComputeAppTable(result, name, orgId);
    this.renderHerokuAppTable(formation, release);
    if (flags.verbose) {
      this.renderExternalServiceTable(result);
      this.renderCurrentBuildTable(result);
      this.renderLatestDeploymentTable(result);
    }

    return {
      ...result, name, orgId, formation, release,
    };
  }

  // Renders the --name value the caller passed in (e.g. myns__CreditRatingScorer), not
  // result.name (record.DeveloperName, which has the namespace stripped) -- every sibling
  // migrated command (scale, logs, config*, build/output) echoes the raw --name the same way.
  private renderComputeAppTable(result: ComputeAppSummary, name: string, orgId: string): void {
    this.styledHeader('Compute App');
    this.table({
      data: [
        {key: 'Compute App ID', value: result.id},
        {key: 'Compute App Name', value: name},
        {key: 'Master Label', value: result.masterLabel},
        {key: 'Status', value: result.status},
        {key: 'Org ID', value: orgId},
        {key: 'Description', value: result.description ?? '-'},
        {key: 'Status Reason', value: result.statusReason ?? '-'},
      ],
      columns: ['key', 'value'],
    });
  }

  // Build Duration is computed client-side from the two timestamps we do have, rather than
  // sourced from anywhere new.
  private renderCurrentBuildTable(result: ComputeAppSummary): void {
    this.styledHeader('Current Build');
    this.table({
      data: [
        {key: 'Build ID', value: result.currentBuild?.id ?? '-'},
        {key: 'Build Status', value: result.currentBuild?.buildStatus ?? '-'},
        {key: 'Build Started', value: result.currentBuild?.buildStartedAt ?? '-'},
        {key: 'Build Completed', value: result.currentBuild?.buildCompletedAt ?? '-'},
        {
          key: 'Build Duration',
          value: formatBuildDuration(result.currentBuild?.buildStartedAt, result.currentBuild?.buildCompletedAt),
        },
      ],
      columns: ['key', 'value'],
    });
  }

  // API Spec Published has no source yet -- placeholder dash. AppLink Add-on was removed --
  // it's redundant with External Service ID (both are set together by deploy's first-time
  // provisioning flow; there's no state where one exists without the other).
  private renderExternalServiceTable(result: ComputeAppSummary): void {
    this.styledHeader('External Service');
    this.table({
      data: [
        {key: 'External Service ID', value: result.externalServiceId ?? '-'},
        {key: 'API Spec Published', value: '-'},
      ],
      columns: ['key', 'value'],
    });
  }

  // App Name/Region have no Salesforce- or Heroku-side source wired up yet -- placeholder dashes
  // until W-24154928 ("[API] Fetch compute app metadata and dyno formation via Connect API
  // (display command)") ships. Formation and Release are fetched from Heroku via the Salesforce
  // proxy above.
  private renderHerokuAppTable(formation: HerokuFormationSummary | undefined, release: number | undefined): void {
    this.styledHeader('Heroku App');
    this.table({
      data: [
        {key: 'App Name', value: '-'},
        {key: 'Region', value: '-'},
        {key: 'Generation', value: '-'},
        {key: 'Release', value: release === undefined ? '-' : String(release)},
        {key: 'Formation', value: formatFormation(formation)},
      ],
      columns: ['key', 'value'],
    });
  }

  private renderLatestDeploymentTable(result: ComputeAppSummary): void {
    this.styledHeader('Latest Deployment');
    this.table({
      data: [
        {key: 'Deployed At', value: result.currentBuild?.deployedAt ?? '-'},
        {key: 'Deployed By', value: result.currentBuild?.deployedBy ?? '-'},
      ],
      columns: ['key', 'value'],
    });
  }
}
