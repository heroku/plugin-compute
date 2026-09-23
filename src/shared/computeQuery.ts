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

import type { Connection } from '@salesforce/core';
import { Messages } from '@salesforce/core';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@salesforce/plugin-compute', 'compute.errors');

// @salesforce/core doesn't re-export SingleRecordQueryErrors from its package root (only from
// the internal org/connection module), so match the stable error names it throws by value.
const SINGLE_RECORD_QUERY_NO_RECORDS = 'SingleRecordQuery_NoRecords';
const SINGLE_RECORD_QUERY_MULTIPLE_RECORDS = 'SingleRecordQuery_MultipleRecords';

// Tooling API record shape for PlatformComputeApp + its current build (via the CurrentBuild
// lookup) and its external service registration (via the ExternalServiceRegistration lookup).
// Both lookups are null until the app's first successful metadata deploy / AppLink publish sets
// them -- see PLATFORMCOMPUTEAPP_ENTITY_SCHEMA.md "Initial Deploy" and "-> ExternalServiceRegistration".
export type ComputeAppRecord = {
  Id: string;
  DeveloperName: string;
  MasterLabel: string;
  Description: string | null;
  Status: 'DEPLOYING' | 'ACTIVE' | 'FAILED';
  StatusReason: string | null;
  CurrentBuild: {
    Id: string;
    BuildStatus: 'PENDING' | 'BUILDING' | 'SUCCEEDED' | 'FAILED';
    BuildStartedAt: string | null;
    BuildCompletedAt: string | null;
    DeployedAt: string | null;
    DeployedBy: { Username: string } | null;
    Error: string | null;
  } | null;
  ExternalServiceRegistration: {
    Id: string;
    // Not queried below (see SOQL_FIELDS) -- Tooling API rejects this column at parse time even
    // with the SfdcInternalQA client override applied. This is a field-level restriction on
    // ExternalServiceRegistration itself, separate from PlatformComputeApp/PlatformComputeAppBuild's
    // entity-level isSfdcInternal restriction (tracked by W-24176390). Optional until that
    // field-level restriction is separately resolved with the ExternalServiceRegistration owning
    // team -- see W-24176390's description for the split.
    IsActive?: boolean;
  } | null;
};

export const SOQL_FIELDS = [
  'Id',
  'DeveloperName',
  'MasterLabel',
  'Description',
  'Status',
  'StatusReason',
  'CurrentBuild.Id',
  'CurrentBuild.BuildStatus',
  'CurrentBuild.BuildStartedAt',
  'CurrentBuild.BuildCompletedAt',
  'CurrentBuild.DeployedAt',
  'CurrentBuild.DeployedBy.Username',
  'CurrentBuild.Error',
  'ExternalServiceRegistration.Id',
].join(', ');

// Internal engineering workaround, not a customer-facing feature -- do not document in README.
// PlatformComputeApp/PlatformComputeAppBuild currently ship with
// Tooling API access gated behind apiAccess="isSfdcInternal" (W-23426078 opened first-party-only
// access; W-24176390 tracks removing the restriction so any customer org can query these entities
// without this workaround). Until W-24176390 ships, this lets internal testing exercise the CLI's
// Tooling queries against a pilot org: jsforce's http-api sets the Sforce-Call-Options header from
// connection._callOptions on every REST request (incl. Tooling API query); this sets the
// SfdcInternalQA/ client identifier, which requires the target org's "Allow Salesforce Internal
// QA Clients" (SfdcInternalQAClients) org perm to be enabled. Gated behind
// SALESFORCE_INTERNAL_QA_CLIENT=true (opt-in, never silently applied). Note this does NOT unblock
// ExternalServiceRegistration.IsActive, which has its own separate field-level restriction --
// see the comment on ComputeAppRecord.ExternalServiceRegistration.IsActive above.
// Remove this function and its call sites once W-24176390 ships and public access is confirmed.
function setSfdcInternalQaCallOptions(connection: Connection): void {
  if (process.env.SALESFORCE_INTERNAL_QA_CLIENT !== 'true') {
    return;
  }
  // eslint-disable-next-line no-underscore-dangle
  (connection as unknown as { _callOptions?: Record<string, string> })._callOptions = {
    client: 'SfdcInternalQA/plugin-compute',
  };
}

// Callers must call validateName(name) first -- name is interpolated directly into SOQL, and
// that regex (letters/digits/underscore, no quotes or spaces) is the injection guard.
export async function queryComputeApp(connection: Connection, name: string): Promise<ComputeAppRecord> {
  setSfdcInternalQaCallOptions(connection);
  const soql = `SELECT ${SOQL_FIELDS} FROM PlatformComputeApp WHERE DeveloperName = '${name}'`;
  try {
    return await connection.singleRecordQuery<ComputeAppRecord>(soql, { tooling: true });
  } catch (err) {
    if (err instanceof Error && err.name === SINGLE_RECORD_QUERY_NO_RECORDS) {
      throw messages.createError('error.appNotFoundInOrg', [name], [name], err);
    }
    if (err instanceof Error && err.name === SINGLE_RECORD_QUERY_MULTIPLE_RECORDS) {
      throw messages.createError('error.ambiguousName', [name], [], err);
    }
    throw messages.createError(
      'error.queryFailed',
      [err instanceof Error ? err.message : String(err)],
      [],
      err instanceof Error ? err : undefined
    );
  }
}

// No --name filter -- lists every PlatformComputeApp in the org. autoFetchQuery auto-paginates
// (10,000-record default fetch size), which comfortably covers any realistic org's compute-app count.
export async function listComputeApps(connection: Connection): Promise<ComputeAppRecord[]> {
  setSfdcInternalQaCallOptions(connection);
  const soql = `SELECT ${SOQL_FIELDS} FROM PlatformComputeApp ORDER BY DeveloperName ASC`;
  try {
    // autoFetchQuery's type param is bounded to jsforce's Schema (org-wide SObject map), not the
    // record shape -- there's no way to type this call against ComputeAppRecord directly.
    const result = await connection.autoFetchQuery(soql, { tooling: true });
    return result.records as unknown as ComputeAppRecord[];
  } catch (err) {
    throw messages.createError(
      'error.queryFailed',
      [err instanceof Error ? err.message : String(err)],
      [],
      err instanceof Error ? err : undefined
    );
  }
}

export type ComputeAppSummary = {
  id: string;
  name: string;
  masterLabel: string;
  description?: string;
  status: 'DEPLOYING' | 'ACTIVE' | 'FAILED';
  statusReason?: string;
  externalServiceId?: string;
  externalServiceRegistered: boolean;
  externalServiceActive?: boolean;
  currentBuild?: {
    id: string;
    buildStatus: 'PENDING' | 'BUILDING' | 'SUCCEEDED' | 'FAILED';
    buildStartedAt?: string;
    buildCompletedAt?: string;
    deployedAt?: string;
    deployedBy?: string;
    error?: string;
  };
};

// Heroku-side runtime metadata (dyno type, web process/formation count) isn't included here --
// there's no confirmed Salesforce-queryable source for it yet. Open item, not yet resolved.
export function toComputeAppSummary(record: ComputeAppRecord): ComputeAppSummary {
  return {
    id: record.Id,
    name: record.DeveloperName,
    masterLabel: record.MasterLabel,
    description: record.Description ?? undefined,
    status: record.Status,
    statusReason: record.StatusReason ?? undefined,
    externalServiceId: record.ExternalServiceRegistration?.Id,
    externalServiceRegistered: record.ExternalServiceRegistration !== null,
    externalServiceActive: record.ExternalServiceRegistration?.IsActive,
    currentBuild: record.CurrentBuild
      ? {
          id: record.CurrentBuild.Id,
          buildStatus: record.CurrentBuild.BuildStatus,
          buildStartedAt: record.CurrentBuild.BuildStartedAt ?? undefined,
          buildCompletedAt: record.CurrentBuild.BuildCompletedAt ?? undefined,
          deployedAt: record.CurrentBuild.DeployedAt ?? undefined,
          deployedBy: record.CurrentBuild.DeployedBy?.Username,
          error: record.CurrentBuild.Error ?? undefined,
        }
      : undefined,
  };
}
