import {type Connection, Org} from '@salesforce/core';
import {MockTestOrgData, TestContext} from '@salesforce/core/testSetup';
import {stubSfCommandUx} from '@salesforce/sf-plugins-core';
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

import List from '../../../src/commands/compute/list.js';

describe('compute list', () => {
  const $$ = new TestContext();
  const testOrg = new MockTestOrgData();
  const stubToolingQuery = (connection: Connection) => $$.SANDBOX.stub(connection.tooling, 'query');
  let sfCommandStubs: ReturnType<typeof stubSfCommandUx>;
  let toolingQueryStub: ReturnType<typeof stubToolingQuery>;

  const activeRecord = {
    CurrentBuild: {
      BuildCompletedAt: '2026-08-04T14:25:32.000Z',
      BuildStartedAt: '2026-08-04T14:23:50.000Z',
      BuildStatus: 'SUCCEEDED',
      DeployedAt: '2026-08-04T14:25:32.000Z',
      DeployedBy: {Username: 'dev@mycompany.com'},
      Error: null,
      Id: '0acEE0000004D1ZYAU',
    },
    Description: 'Parses lease agreements.',
    DeveloperName: 'CreditRatingScorer',
    ExternalServiceRegistration: {Id: '0ES0x00000ABC456', IsActive: true},
    Id: '0abEE0000004CqYYAU',
    MasterLabel: 'Lease Agreement Parser',
    Status: 'ACTIVE',
    StatusReason: null,
  };

  const deployingRecord = {
    CurrentBuild: null,
    Description: null,
    DeveloperName: 'InvoiceMatcher',
    ExternalServiceRegistration: null,
    Id: '0abEE0000004CqZYAU',
    MasterLabel: 'Invoice Matcher',
    Status: 'DEPLOYING',
    StatusReason: null,
  };

  beforeEach(async () => {
    sfCommandStubs = stubSfCommandUx($$.SANDBOX);
    await $$.stubAuths(testOrg);

    const org = await Org.create({aliasOrUsername: testOrg.username});
    const connection = org.getConnection();
    toolingQueryStub = stubToolingQuery(connection);
    $$.SANDBOX.stub(Org.prototype, 'getConnection').returns(connection);
  });

  afterEach(() => {
    $$.restore();
  });

  function resolveWith(records: unknown[]): void {
    toolingQueryStub.resolves({done: true, records, totalSize: records.length} as never);
  }

  it('returns the flattened list of every compute app in the org', async () => {
    resolveWith([activeRecord, deployingRecord]);

    const result = await List.run(['--target-org', testOrg.username]);

    expect(result).toEqual([
      {
        currentBuild: {
          buildCompletedAt: '2026-08-04T14:25:32.000Z',
          buildStartedAt: '2026-08-04T14:23:50.000Z',
          buildStatus: 'SUCCEEDED',
          deployedAt: '2026-08-04T14:25:32.000Z',
          deployedBy: 'dev@mycompany.com',
          error: undefined,
          id: '0acEE0000004D1ZYAU',
        },
        description: 'Parses lease agreements.',
        externalServiceActive: true,
        externalServiceId: '0ES0x00000ABC456',
        externalServiceRegistered: true,
        id: '0abEE0000004CqYYAU',
        masterLabel: 'Lease Agreement Parser',
        name: 'CreditRatingScorer',
        status: 'ACTIVE',
        statusReason: undefined,
      },
      {
        currentBuild: undefined,
        description: undefined,
        externalServiceActive: undefined,
        externalServiceId: undefined,
        externalServiceRegistered: false,
        id: '0abEE0000004CqZYAU',
        masterLabel: 'Invoice Matcher',
        name: 'InvoiceMatcher',
        status: 'DEPLOYING',
        statusReason: undefined,
      },
    ]);
  });

  it('queries with no WHERE clause and orders by DeveloperName', async () => {
    resolveWith([activeRecord]);

    await List.run(['--target-org', testOrg.username]);

    const soql = toolingQueryStub.firstCall.args[0];
    expect(soql).toContain('FROM PlatformComputeApp');
    expect(soql).toContain('ORDER BY DeveloperName ASC');
    expect(soql).not.toContain('WHERE');
  });

  it('renders a table with the default columns', async () => {
    resolveWith([activeRecord]);

    await List.run(['--target-org', testOrg.username]);

    expect(sfCommandStubs.styledHeader.calledWith('Compute Apps')).toBe(true);
    const [{columns, data}] = sfCommandStubs.table.firstCall.args as [{columns: string[]; data: unknown[]}];
    expect(columns).toEqual(['name', 'masterLabel', 'status', 'statusReason']);
    expect(data).toHaveLength(1);
  });

  it('prints a no-apps-found message and returns an empty array without rendering a table', async () => {
    resolveWith([]);

    const result = await List.run(['--target-org', testOrg.username]);

    expect(result).toEqual([]);
    expect(sfCommandStubs.styledHeader.called).toBe(false);
    expect(sfCommandStubs.table.called).toBe(false);
    expect(sfCommandStubs.info.firstCall.args[0]).toContain('No compute apps were found in the org');
  });

  it('wraps an unexpected query failure', async () => {
    toolingQueryStub.rejects(new Error('INVALID_SESSION_ID'));

    await expect(List.run(['--target-org', testOrg.username])).rejects.toThrow("Couldn't query compute app details: INVALID_SESSION_ID");
  });
});
