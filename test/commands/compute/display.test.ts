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
import { Org, SfError } from '@salesforce/core';
import { stubSfCommandUx } from '@salesforce/sf-plugins-core';
import Display from '../../../src/commands/compute/display.js';

describe('compute display', () => {
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

  it('returns the flattened result for an active app with a current build', async () => {
    resolveWith([activeRecord]);

    const result = await Display.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result).to.deep.equal({
      name: 'CreditRatingScorer',
      masterLabel: 'Lease Agreement Parser',
      description: 'Parses lease agreements.',
      status: 'ACTIVE',
      statusReason: undefined,
      externalServiceRegistered: true,
      externalServiceActive: true,
      currentBuild: {
        buildStatus: 'SUCCEEDED',
        buildStartedAt: '2026-08-04T14:23:50.000Z',
        buildCompletedAt: '2026-08-04T14:25:32.000Z',
        deployedAt: '2026-08-04T14:25:32.000Z',
        deployedBy: 'dev@mycompany.com',
        error: undefined,
      },
    });

    const soql: string = toolingQueryStub.firstCall.args[0];
    expect(soql).to.include("WHERE DeveloperName = 'CreditRatingScorer'");
  });

  it('includes currentBuild in the JSON result even without --verbose', async () => {
    resolveWith([activeRecord]);

    const result = await Display.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result.currentBuild).to.not.be.undefined;
    const output =
      sfCommandStubs.styledHeader
        ?.getCalls()
        .flatMap((c) => c.args)
        .join('\n') ?? '';
    expect(output).to.not.include('Current Build');
  });

  it('renders External Service and Current Build sections under --verbose', async () => {
    resolveWith([activeRecord]);

    await Display.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username, '--verbose']);

    const headers = sfCommandStubs.styledHeader.getCalls().flatMap((c) => c.args);
    expect(headers).to.include('External Service');
    expect(headers).to.include('Current Build');
  });

  it('handles an app that has never had a successful build or external service registration', async () => {
    resolveWith([
      {
        ...activeRecord,
        Status: 'DEPLOYING',
        CurrentBuild: null,
        ExternalServiceRegistration: null,
      },
    ]);

    const result = await Display.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result.currentBuild).to.be.undefined;
    expect(result.externalServiceRegistered).to.be.false;
    expect(result.externalServiceActive).to.be.undefined;
  });

  it('omits description and reports a status reason when the app has neither a description nor a build', async () => {
    resolveWith([
      {
        ...activeRecord,
        Description: null,
        Status: 'FAILED',
        StatusReason: 'Buildpack detection failed.',
        CurrentBuild: null,
      },
    ]);

    const result = await Display.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    expect(result.description).to.be.undefined;
    expect(result.statusReason).to.equal('Buildpack detection failed.');
  });

  it('preserves the exact case of --name in the SOQL filter', async () => {
    resolveWith([activeRecord]);

    await Display.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);

    const soql: string = toolingQueryStub.firstCall.args[0];
    expect(soql).to.include("DeveloperName = 'CreditRatingScorer'");
    expect(soql).to.not.include("DeveloperName = 'creditratingscorer'");
  });

  it('fails with a deploy hint when the app is not found in the org', async () => {
    resolveWith([]);

    try {
      await Display.run(['--name', 'NeverDeployed', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include('No compute app named NeverDeployed was found in the org');
      const actions = (e as SfError).actions ?? [];
      expect(actions.join('\n')).to.include('compute deploy');
      expect(actions.join('\n')).to.not.include('%s');
    }
  });

  it('fails when more than one matching app is found', async () => {
    resolveWith([activeRecord, activeRecord]);

    try {
      await Display.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include('Found more than one compute app named CreditRatingScorer');
    }
  });

  it('wraps an unexpected query failure', async () => {
    toolingQueryStub.rejects(new Error('INVALID_SESSION_ID'));

    try {
      await Display.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include("Couldn't query compute app details: INVALID_SESSION_ID");
    }
  });

  it('rejects an invalid name before querying', async () => {
    try {
      await Display.run(['--name', '../evil', '--target-org', testOrg.username]);
      expect.fail('expected an error');
    } catch (e) {
      expect((e as Error).message).to.include("isn't valid");
    }
    expect(toolingQueryStub.called).to.be.false;
  });
});
