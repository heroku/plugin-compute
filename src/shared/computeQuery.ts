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

import {type Connection, Messages} from '@salesforce/core';

import {parseName} from './computeApp.js';
import {PLUGIN_NAME} from './plugin-name.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages(PLUGIN_NAME, 'compute.errors');

// @salesforce/core doesn't re-export SingleRecordQueryErrors from its package root (only from
// the internal org/connection module), so match the stable error names it throws by value.
const SINGLE_RECORD_QUERY_NO_RECORDS = 'SingleRecordQuery_NoRecords';
const SINGLE_RECORD_QUERY_MULTIPLE_RECORDS = 'SingleRecordQuery_MultipleRecords';

// Tooling API record shape for PlatformComputeApp + its current build (via the CurrentBuild
// lookup) and its external service registration (via the ExternalServiceRegistration lookup).
// Both lookups are null until the app's first successful metadata deploy / AppLink publish sets
// them -- see PLATFORMCOMPUTEAPP_ENTITY_SCHEMA.md "Initial Deploy" and "-> ExternalServiceRegistration".
export type ComputeAppRecord = {
  CurrentBuild: null | {
    BuildCompletedAt: null | string;
    BuildStartedAt: null | string;
    BuildStatus: 'BUILDING' | 'FAILED' | 'PENDING' | 'SUCCEEDED';
    DeployedAt: null | string;
    DeployedBy: null | {Username: string};
    Error: null | string;
    // Heroku's own build id -- see ExternalAppIdentifier's comment above; same gating, same
    // "written by async worker post-insert" caveat, so can be null even on a record that has one.
    ExternalBuildIdentifier?: null | string;
    Id: string;
  };
  Description: null | string;
  DeveloperName: string;
  // Heroku's own app id -- NOT the same value as DeveloperName, which is Salesforce-side only.
  // Only present in the queried record (see soqlFields()) under SALESFORCE_INTERNAL_QA_CLIENT,
  // since it shares PlatformComputeApp's entity-level isSfdcInternal restriction (W-24176390).
  // Undefined/null until then, and until the app's first successful build sets it.
  ExternalAppIdentifier?: null | string;
  ExternalServiceRegistration: null | {
    Id: string;
    // Not queried below (see soqlFields()) -- Tooling API rejects this column at parse time even
    // with the SfdcInternalQA client override applied. This is a field-level restriction on
    // ExternalServiceRegistration itself, separate from PlatformComputeApp/PlatformComputeAppBuild's
    // entity-level isSfdcInternal restriction (tracked by W-24176390). Optional until that
    // field-level restriction is separately resolved with the ExternalServiceRegistration owning
    // team -- see W-24176390's description for the split.
    IsActive?: boolean;
  };
  Id: string;
  MasterLabel: string;
  Status: 'ACTIVE' | 'DEPLOYING' | 'FAILED';
  StatusReason: null | string;
};

const BASE_SOQL_FIELDS = [
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
];

// ExternalAppIdentifier/CurrentBuild.ExternalBuildIdentifier share PlatformComputeApp's
// entity-level isSfdcInternal restriction (W-24176390) -- querying them without the
// SfdcInternalQA client override applied (see setSfdcInternalQaCallOptions below) fails the whole
// query, so only add them once that override is already in effect. Keeps the default query text
// byte-for-byte unchanged until W-24176390 ships.
function soqlFields(): string {
  const fields =
    process.env.SALESFORCE_INTERNAL_QA_CLIENT === 'true'
      ? [...BASE_SOQL_FIELDS, 'ExternalAppIdentifier', 'CurrentBuild.ExternalBuildIdentifier']
      : BASE_SOQL_FIELDS;
  return fields.join(', ');
}

// Defense-in-depth for the SOQL string interpolations in queryComputeApp/listComputeApps below --
// parseName's regexes already reject the characters SOQL string literals need escaped, so this
// should never actually fire, but it keeps a future NAME_PATTERN/NAMESPACE_PATTERN change from
// silently reopening injection.
function escapeSoqlLiteral(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('\'', String.raw`\'`);
}

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

  (connection as unknown as {_callOptions?: Record<string, string>})._callOptions = {
    client: 'SfdcInternalQA/plugin-compute',
  };
}

// Accepts a bare DeveloperName or a namespace-qualified <namespace>__<developerName> value; the
// latter adds a Namespace filter so it only matches an app deployed under that namespace, since
// DeveloperName alone isn't unique across namespaces.
export async function queryComputeApp(connection: Connection, name: string): Promise<ComputeAppRecord> {
  setSfdcInternalQaCallOptions(connection);
  // parseName's NAME_PATTERN/NAMESPACE_PATTERN (letters/digits/underscore, anchored, no quotes or
  // spaces) are the injection guard for the two interpolations below -- escapeSoqlLiteral is
  // belt-and-suspenders in case either pattern is ever loosened, not the primary defense.
  const {namespace, developerName} = parseName(name);
  const namespaceFilter = namespace === undefined ? '' : ` AND Namespace = '${escapeSoqlLiteral(namespace)}'`;
  const soql = `SELECT ${soqlFields()} FROM PlatformComputeApp WHERE DeveloperName = '${escapeSoqlLiteral(
    developerName,
  )}'${namespaceFilter}`;
  try {
    return await connection.singleRecordQuery<ComputeAppRecord>(soql, {tooling: true});
  } catch (error) {
    if (error instanceof Error && error.name === SINGLE_RECORD_QUERY_NO_RECORDS) {
      throw messages.createError('error.appNotFoundInOrg', [name], [name], error);
    }

    if (error instanceof Error && error.name === SINGLE_RECORD_QUERY_MULTIPLE_RECORDS) {
      throw messages.createError('error.ambiguousName', [name], [], error);
    }

    throw messages.createError(
      'error.queryFailed',
      [error instanceof Error ? error.message : String(error)],
      [],
      error instanceof Error ? error : undefined,
    );
  }
}

// No --name filter -- lists every PlatformComputeApp in the org. autoFetchQuery auto-paginates
// (10,000-record default fetch size), which comfortably covers any realistic org's compute-app count.
export async function listComputeApps(connection: Connection): Promise<ComputeAppRecord[]> {
  setSfdcInternalQaCallOptions(connection);
  const soql = `SELECT ${soqlFields()} FROM PlatformComputeApp ORDER BY DeveloperName ASC`;
  try {
    // autoFetchQuery's type param is bounded to jsforce's Schema (org-wide SObject map), not the
    // record shape -- there's no way to type this call against ComputeAppRecord directly.
    const result = await connection.autoFetchQuery(soql, {tooling: true});
    return result.records as unknown as ComputeAppRecord[];
  } catch (error) {
    throw messages.createError(
      'error.queryFailed',
      [error instanceof Error ? error.message : String(error)],
      [],
      error instanceof Error ? error : undefined,
    );
  }
}

export type ComputeAppSummary = {
  currentBuild?: {
    buildCompletedAt?: string;
    buildStartedAt?: string;
    buildStatus: 'BUILDING' | 'FAILED' | 'PENDING' | 'SUCCEEDED';
    deployedAt?: string;
    deployedBy?: string;
    error?: string;
    id: string;
  };
  description?: string;
  externalServiceActive?: boolean;
  externalServiceId?: string;
  externalServiceRegistered: boolean;
  id: string;
  masterLabel: string;
  name: string;
  status: 'ACTIVE' | 'DEPLOYING' | 'FAILED';
  statusReason?: string;
};

// Pure extraction, no fallback to DeveloperName -- a Heroku proxy call must never receive the
// Salesforce-side name in place of Heroku's own app id, so callers that get undefined back must
// either skip the Heroku call (display.ts) or hard-error (requireHerokuAppId/resolveHerokuAppId
// below), never silently substitute name on the wire.
export function pickHerokuAppId(record: ComputeAppRecord): string | undefined {
  return record.ExternalAppIdentifier ?? undefined;
}

// For callers that already hold a queried ComputeAppRecord (logs.ts, build/output.ts) and just
// need to gate on/extract the Heroku app id without a second query.
export function requireHerokuAppId(record: ComputeAppRecord, name: string): string {
  const herokuAppId = pickHerokuAppId(record);
  if (!herokuAppId) {
    throw messages.createError('error.herokuAppIdentifierUnavailable', [name]);
  }

  return herokuAppId;
}

// For callers that don't otherwise query the org (scale.ts, config/*.ts) -- runs the same
// queryComputeApp lookup those commands now require (see validateName's call-site contract above)
// and extracts the Heroku app id in one step.
export async function resolveHerokuAppId(connection: Connection, name: string): Promise<string> {
  const record = await queryComputeApp(connection, name);
  return requireHerokuAppId(record, name);
}

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
