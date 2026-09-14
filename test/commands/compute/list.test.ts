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
import { expect } from 'chai';
import sinon from 'sinon';
import { TestContext, MockTestOrgData } from '@salesforce/core/testSetup';
import { Org } from '@salesforce/core';
import { stubSfCommandUx } from '@salesforce/sf-plugins-core';
import List from '../../../src/commands/compute/list.js';

describe('compute list', () => {
  const $$ = new TestContext();
  const testOrg = new MockTestOrgData();
  let sfCommandStubs: ReturnType<typeof stubSfCommandUx>;
  let toolingQueryStub: sinon.SinonStub;

  const activeRecord = {
    Id: '0abEE0000004CqYYAU',
    DeveloperName: 'CreditRatingScorer',
    MasterLabel: 'Lease Agreement Parser',
    Description: 'Parses lease agreements.',
    Status: 'ACTIVE',
    StatusReason: null,
    CurrentBuild: {
      Id: '0acEE0000004D1ZYAU',
      BuildStatus: 'SUCCEEDED',
      BuildStartedAt: '2026-08-04T14:23:50.000Z',
      BuildCompletedAt: '2026-08-04T14:25:32.000Z',
      DeployedAt: '2026-08-04T14:25:32.000Z',
      DeployedBy: { Username: 'dev@mycompany.com' },
      Error: null,
    },
    ExternalServiceRegistration: { Id: '0ES0x00000ABC456', IsActive: true },
  };

  const deployingRecord = {
    Id: '0abEE0000004CqZYAU',
    DeveloperName: 'InvoiceMatcher',
    MasterLabel: 'Invoice Matcher',
    Description: null,
    Status: 'DEPLOYING',
    StatusReason: null,
    CurrentBuild: null,
    ExternalServiceRegistration: null,
  };

  beforeEach(async () => {
    sfCommandStubs = stubSfCommandUx($$.SANDBOX);
    await $$.stubAuths(testOrg);

    const org = await Org.create({ aliasOrUsername: testOrg.username });
    const connection = org.getConnection();
    toolingQueryStub = $$.SANDBOX.stub(connection.tooling, 'query');
    $$.SANDBOX.stub(Org.prototype, 'getConnection').returns(connection);
  });

  afterEach(() => {
    $$.restore();
  });

  function resolveWith(records: unknown[]): void {
    toolingQueryStub.resolves({ totalSize: records.length, records, done: true });
  }

  it('returns the flattened list of every compute app in the org', async () => {
    resolveWith([activeRecord, deployingRecord]);

    const result = await List.run(['--target-org', testOrg.username]);

    expect(result).to.deep.equal([
      {
        id: '0abEE0000004CqYYAU',
        name: 'CreditRatingScorer',
        masterLabel: 'Lease Agreement Parser',
        description: 'Parses lease agreements.',
        status: 'ACTIVE',
        statusReason: undefined,
        externalServiceId: '0ES0x00000ABC456',
        externalServiceRegistered: true,
        externalServiceActive: true,
        currentBuild: {
          id: '0acEE0000004D1ZYAU',
          buildStatus: 'SUCCEEDED',
          buildStartedAt: '2026-08-04T14:23:50.000Z',
          buildCompletedAt: '2026-08-04T14:25:32.000Z',
          deployedAt: '2026-08-04T14:25:32.000Z',
          deployedBy: 'dev@mycompany.com',
          error: undefined,
        },
      },
      {
        id: '0abEE0000004CqZYAU',
        name: 'InvoiceMatcher',
        masterLabel: 'Invoice Matcher',
        description: undefined,
        status: 'DEPLOYING',
        statusReason: undefined,
        externalServiceId: undefined,
        externalServiceRegistered: false,
        externalServiceActive: undefined,
        currentBuild: undefined,
      },
    ]);
  });

  it('queries with no WHERE clause and orders by DeveloperName', async () => {
    resolveWith([activeRecord]);

    await List.run(['--target-org', testOrg.username]);

    const soql: string = toolingQueryStub.firstCall.args[0];
    expect(soql).to.include('FROM PlatformComputeApp');
    expect(soql).to.include('ORDER BY DeveloperName ASC');
    expect(soql).to.not.include('WHERE');
  });

  it('renders a table with the default columns', async () => {
    resolveWith([activeRecord]);

    await List.run(['--target-org', testOrg.username]);

    expect(sfCommandStubs.styledHeader.calledWith('Compute Apps')).to.be.true;
    const [{ columns, data }] = sfCommandStubs.table.firstCall.args as [{ columns: string[]; data: unknown[] }];
    expect(columns).to.deep.equal(['name', 'masterLabel', 'status', 'statusReason']);
    expect(data).to.have.lengthOf(1);
  });

  it('prints a no-apps-found message and returns an empty array without rendering a table', async () => {
    resolveWith([]);

    const result = await List.run(['--target-org', testOrg.username]);

    expect(result).to.deep.equal([]);
    expect(sfCommandStubs.styledHeader.called).to.be.false;
    expect(sfCommandStubs.table.called).to.be.false;
    expect(sfCommandStubs.info.firstCall.args[0]).to.include('No compute apps were found in the org');
  });

  it('wraps an unexpected query failure', async () => {
    toolingQueryStub.rejects(new Error('INVALID_SESSION_ID'));

    try {
      await List.run(['--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include("Couldn't query compute app details: INVALID_SESSION_ID");
    }
  });
});
