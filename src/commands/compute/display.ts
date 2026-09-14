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
import { Messages } from '@salesforce/core';
import { validateName, requireAppName, resolveComputeAppNameFromDir } from '../../shared/computeApp.js';
import { queryComputeApp, toComputeAppSummary, type ComputeAppSummary } from '../../shared/computeQuery.js';
import { getHerokuApiToken } from '../../shared/herokuApi.js';
import { fetchComputeFormationViaHeroku, type HerokuFormationSummary } from '../../shared/herokuComputeApi.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@salesforce/plugin-compute', 'compute.display');

// formation is only populated when HEROKU_API_TOKEN is set and Heroku answers -- it's a
// best-effort supplement to the org-side ComputeAppSummary fields, never a replacement for them.
export type ComputeDisplayResult = ComputeAppSummary & { orgId: string; formation?: HerokuFormationSummary };

// Heroku's own TYPE=COUNT[:SIZE] scale-target shape (see `sf compute scale`), reused here to
// render the Formation row -- e.g. "web=1:eco", or "web=2, worker=1:standard-1x" for multiple.
function formatFormation(formation: HerokuFormationSummary | undefined): string {
  if (!formation || formation.length === 0) {
    return '-';
  }
  return formation.map((f) => `${f.type}=${f.quantity}${f.dynoSize ? `:${f.dynoSize}` : ''}`).join(', ');
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
  public static readonly summary = messages.getMessage('summary');
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');
  // Pure org-side lookup by --name (DeveloperName) -- no local project files are read.
  public static readonly requiresProject = false;

  public static readonly flags = {
    name: Flags.string({
      char: 'n',
      env: 'COMPUTE_APP_NAME',
      summary: messages.getMessage('flags.name.summary'),
    }),
    'target-org': Flags.requiredOrg({ char: 'o' }),
    verbose: Flags.boolean({
      char: 'v',
      summary: messages.getMessage('flags.verbose.summary'),
    }),
  };

  public async run(): Promise<ComputeDisplayResult> {
    const { flags } = await this.parse(Display);
    const name = requireAppName(flags.name ?? (await resolveComputeAppNameFromDir(process.cwd())));
    validateName(name);

    const connection = flags['target-org'].getConnection();
    const record = await queryComputeApp(connection, name);
    const result = toComputeAppSummary(record);
    const orgId = flags['target-org'].getOrgId();

    let formation: HerokuFormationSummary | undefined;
    const herokuToken = getHerokuApiToken();
    if (herokuToken) {
      try {
        formation = await fetchComputeFormationViaHeroku(herokuToken, { name });
      } catch (err) {
        this.warn(messages.getMessage('warning.herokuFormationUnavailable', [(err as Error).message]));
      }
    }

    this.renderComputeAppTable(result, orgId);
    this.renderHerokuAppTable(formation);
    if (flags.verbose) {
      this.renderExternalServiceTable(result);
      this.renderCurrentBuildTable(result);
      this.renderLatestDeploymentTable(result);
    }

    return { ...result, orgId, formation };
  }

  private renderComputeAppTable(result: ComputeAppSummary, orgId: string): void {
    this.styledHeader('Compute App');
    this.table({
      data: [
        { key: 'Compute App ID', value: result.id },
        { key: 'Compute App Name', value: result.name },
        { key: 'Master Label', value: result.masterLabel },
        { key: 'Status', value: result.status },
        { key: 'Org ID', value: orgId },
        { key: 'Description', value: result.description ?? '-' },
        { key: 'Status Reason', value: result.statusReason ?? '-' },
      ],
      columns: ['key', 'value'],
    });
  }

  // App Name/Region/Generation have no Salesforce- or Heroku-side source wired up yet (Heroku's
  // GET /apps/{app_id_or_name} is still (proposed) per the CLI design doc's APIs table) --
  // placeholder dashes until that lands. Formation is real: it's already fetched from Heroku
  // above whenever HEROKU_API_TOKEN is set.
  private renderHerokuAppTable(formation: HerokuFormationSummary | undefined): void {
    this.log('');
    this.styledHeader('Heroku App');
    this.table({
      data: [
        { key: 'App Name', value: '-' },
        { key: 'Region', value: '-' },
        { key: 'Generation', value: '-' },
        { key: 'Formation', value: formatFormation(formation) },
      ],
      columns: ['key', 'value'],
    });
  }

  // AppLink Add-on / API Spec Published have no source yet -- placeholder dashes.
  private renderExternalServiceTable(result: ComputeAppSummary): void {
    this.log('');
    this.styledHeader('External Service');
    this.table({
      data: [
        { key: 'External Service ID', value: result.externalServiceId ?? '-' },
        { key: 'AppLink Add-on', value: '-' },
        { key: 'API Spec Published', value: '-' },
      ],
      columns: ['key', 'value'],
    });
  }

  // Slug has no source yet -- placeholder dash. Build Duration is computed client-side from the
  // two timestamps we do have, rather than sourced from anywhere new.
  private renderCurrentBuildTable(result: ComputeAppSummary): void {
    this.log('');
    this.styledHeader('Current Build');
    this.table({
      data: [
        { key: 'Build ID', value: result.currentBuild?.id ?? '-' },
        { key: 'Build Status', value: result.currentBuild?.buildStatus ?? '-' },
        { key: 'Slug', value: '-' },
        { key: 'Build Started', value: result.currentBuild?.buildStartedAt ?? '-' },
        { key: 'Build Completed', value: result.currentBuild?.buildCompletedAt ?? '-' },
        {
          key: 'Build Duration',
          value: formatBuildDuration(result.currentBuild?.buildStartedAt, result.currentBuild?.buildCompletedAt),
        },
      ],
      columns: ['key', 'value'],
    });
  }

  // Deploy ID / Release have no source yet -- placeholder dashes.
  private renderLatestDeploymentTable(result: ComputeAppSummary): void {
    this.log('');
    this.styledHeader('Latest Deployment');
    this.table({
      data: [
        { key: 'Deployed At', value: result.currentBuild?.deployedAt ?? '-' },
        { key: 'Deployed By', value: result.currentBuild?.deployedBy ?? '-' },
        { key: 'Deploy ID', value: '-' },
        { key: 'Release', value: '-' },
      ],
      columns: ['key', 'value'],
    });
  }
}
