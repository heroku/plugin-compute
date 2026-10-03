import {type Connection, SfError} from '@salesforce/core';
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
import {expect} from 'chai';
import sinon from 'sinon';

import {
  listComputeApps,
  pickHerokuAppId,
  queryComputeApp,
  requireHerokuAppId,
  resolveHerokuAppId,
  toComputeAppSummary,
} from '../../src/shared/computeQuery.js';

const activeRecord = {
  CurrentBuild: null,
  Description: 'Parses lease agreements.',
  DeveloperName: 'CreditRatingScorer',
  ExternalServiceRegistration: null,
  Id: '0abEE0000004CqYYAU',
  MasterLabel: 'Lease Agreement Parser',
  Status: 'ACTIVE' as const,
  StatusReason: null,
};

describe('computeQuery.queryComputeApp', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('queries PlatformComputeApp via the Tooling API with the CurrentBuild and ExternalServiceRegistration relationship fields', async () => {
    const singleRecordQuery = sinon.stub().resolves(activeRecord);
    const connection = {singleRecordQuery} as unknown as Connection;

    const result = await queryComputeApp(connection, 'CreditRatingScorer');

    expect(result).to.deep.equal(activeRecord);
    expect(singleRecordQuery.calledOnce).to.be.true;
    const [soql, options] = singleRecordQuery.firstCall.args as [string, {tooling?: boolean}];
    expect(soql).to.include('FROM PlatformComputeApp');
    expect(soql).to.include("WHERE DeveloperName = 'CreditRatingScorer'");
    expect(soql).to.include('CurrentBuild.BuildStatus');
    expect(soql).to.include('CurrentBuild.DeployedBy.Username');
    expect(soql).to.include('ExternalServiceRegistration.Id');
    // IsActive is deliberately not queried -- the Tooling API rejects that column at parse time
    // even with the SfdcInternalQA client override applied (see ComputeAppRecord.
    // ExternalServiceRegistration.IsActive's comment in computeQuery.ts).
    expect(soql).to.not.include('ExternalServiceRegistration.IsActive');
    expect(options).to.deep.equal({tooling: true});
  });

  it('does not query ExternalAppIdentifier or CurrentBuild.ExternalBuildIdentifier by default', async () => {
    const singleRecordQuery = sinon.stub().resolves(activeRecord);
    const connection = {singleRecordQuery} as unknown as Connection;

    await queryComputeApp(connection, 'CreditRatingScorer');

    const [soql] = singleRecordQuery.firstCall.args as [string];
    expect(soql).to.not.include('ExternalAppIdentifier');
    expect(soql).to.not.include('ExternalBuildIdentifier');
  });

  it('queries ExternalAppIdentifier and CurrentBuild.ExternalBuildIdentifier when SALESFORCE_INTERNAL_QA_CLIENT=true', async () => {
    const singleRecordQuery = sinon.stub().resolves(activeRecord);
    const connection = {singleRecordQuery} as unknown as Connection;
    process.env.SALESFORCE_INTERNAL_QA_CLIENT = 'true';
    try {
      await queryComputeApp(connection, 'CreditRatingScorer');
    } finally {
      delete process.env.SALESFORCE_INTERNAL_QA_CLIENT;
    }

    const [soql] = singleRecordQuery.firstCall.args as [string];
    expect(soql).to.include('ExternalAppIdentifier');
    expect(soql).to.include('CurrentBuild.ExternalBuildIdentifier');
  });

  it('adds a Namespace filter when name is namespace-qualified', async () => {
    const singleRecordQuery = sinon.stub().resolves({...activeRecord, DeveloperName: 'CreditRatingScorer'});
    const connection = {singleRecordQuery} as unknown as Connection;

    await queryComputeApp(connection, 'myns__CreditRatingScorer');

    const [soql] = singleRecordQuery.firstCall.args as [string];
    expect(soql).to.include("WHERE DeveloperName = 'CreditRatingScorer'");
    expect(soql).to.include("AND Namespace = 'myns'");
  });

  it('does not add a Namespace filter for a bare DeveloperName', async () => {
    const singleRecordQuery = sinon.stub().resolves(activeRecord);
    const connection = {singleRecordQuery} as unknown as Connection;

    await queryComputeApp(connection, 'CreditRatingScorer');

    const [soql] = singleRecordQuery.firstCall.args as [string];
    expect(soql).to.not.include('Namespace');
  });

  it('rejects an invalid --name before issuing any query', async () => {
    const singleRecordQuery = sinon.stub().resolves(activeRecord);
    const connection = {singleRecordQuery} as unknown as Connection;

    try {
      await queryComputeApp(connection, 'My-App');
      expect.fail('expected queryComputeApp to throw');
    } catch (error) {
      expect((error as Error).message).to.include("isn't valid");
    }

    expect(singleRecordQuery.called).to.be.false;
  });

  it('maps a zero-record result to a deploy-hint error with the name filled into both the message and the actions', async () => {
    const singleRecordQuery = sinon.stub().rejects(new SfError('No records found', 'SingleRecordQuery_NoRecords'));
    const connection = {singleRecordQuery} as unknown as Connection;

    try {
      await queryComputeApp(connection, 'NeverDeployed');
      expect.fail('expected queryComputeApp to throw');
    } catch (error) {
      const e = error as SfError;
      expect(e.message).to.include('No compute app named NeverDeployed was found in the org');
      const actions = e.actions ?? [];
      expect(actions.join('\n')).to.include('compute deploy');
      expect(actions.join('\n')).to.not.include('%s');
    }
  });

  it('maps a multiple-record result to an ambiguous-name error', async () => {
    const singleRecordQuery = sinon
      .stub()
      .rejects(new SfError('Multiple records found', 'SingleRecordQuery_MultipleRecords'));
    const connection = {singleRecordQuery} as unknown as Connection;

    try {
      await queryComputeApp(connection, 'CreditRatingScorer');
      expect.fail('expected queryComputeApp to throw');
    } catch (error) {
      expect((error as Error).message).to.include('Found more than one compute app named CreditRatingScorer');
    }
  });

  it('wraps an unexpected Error-typed query failure', async () => {
    const singleRecordQuery = sinon.stub().rejects(new Error('INVALID_SESSION_ID'));
    const connection = {singleRecordQuery} as unknown as Connection;

    try {
      await queryComputeApp(connection, 'CreditRatingScorer');
      expect.fail('expected queryComputeApp to throw');
    } catch (error) {
      expect((error as Error).message).to.include("Couldn't query compute app details: INVALID_SESSION_ID");
    }
  });

  it('wraps a non-Error throw (e.g. a rejected string) without crashing', async () => {
    const singleRecordQuery = sinon.stub().callsFake(async () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- deliberately throws a non-Error string to exercise the "wraps a non-Error throw" branch
      throw 'INVALID_SESSION_ID';
    });
    const connection = {singleRecordQuery} as unknown as Connection;

    try {
      await queryComputeApp(connection, 'CreditRatingScorer');
      expect.fail('expected queryComputeApp to throw');
    } catch (error) {
      expect((error as Error).message).to.include("Couldn't query compute app details: INVALID_SESSION_ID");
    }
  });
});

describe('computeQuery.listComputeApps', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('lists every PlatformComputeApp in the org, ordered by DeveloperName, with no WHERE clause', async () => {
    const autoFetchQuery = sinon.stub().resolves({done: true, records: [activeRecord], totalSize: 1});
    const connection = {autoFetchQuery} as unknown as Connection;

    const result = await listComputeApps(connection);

    expect(result).to.deep.equal([activeRecord]);
    expect(autoFetchQuery.calledOnce).to.be.true;
    const [soql, options] = autoFetchQuery.firstCall.args as [string, {tooling?: boolean}];
    expect(soql).to.include('FROM PlatformComputeApp');
    expect(soql).to.include('ORDER BY DeveloperName ASC');
    expect(soql).to.not.include('WHERE');
    expect(options).to.deep.equal({tooling: true});
  });

  it('returns an empty array when the org has no compute apps', async () => {
    const autoFetchQuery = sinon.stub().resolves({done: true, records: [], totalSize: 0});
    const connection = {autoFetchQuery} as unknown as Connection;

    const result = await listComputeApps(connection);

    expect(result).to.deep.equal([]);
  });

  it('wraps an unexpected Error-typed query failure', async () => {
    const autoFetchQuery = sinon.stub().rejects(new Error('INVALID_SESSION_ID'));
    const connection = {autoFetchQuery} as unknown as Connection;

    try {
      await listComputeApps(connection);
      expect.fail('expected listComputeApps to throw');
    } catch (error) {
      expect((error as Error).message).to.include("Couldn't query compute app details: INVALID_SESSION_ID");
    }
  });

  it('wraps a non-Error throw (e.g. a rejected string) without crashing', async () => {
    const autoFetchQuery = sinon.stub().callsFake(async () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- deliberately throws a non-Error string to exercise the "wraps a non-Error throw" branch
      throw 'INVALID_SESSION_ID';
    });
    const connection = {autoFetchQuery} as unknown as Connection;

    try {
      await listComputeApps(connection);
      expect.fail('expected listComputeApps to throw');
    } catch (error) {
      expect((error as Error).message).to.include("Couldn't query compute app details: INVALID_SESSION_ID");
    }
  });
});

describe('computeQuery.toComputeAppSummary', () => {
  it('flattens a full record with a current build and an active external service', () => {
    const result = toComputeAppSummary({
      ...activeRecord,
      CurrentBuild: {
        BuildCompletedAt: '2026-08-04T14:25:32.000Z',
        BuildStartedAt: '2026-08-04T14:23:50.000Z',
        BuildStatus: 'SUCCEEDED',
        DeployedAt: '2026-08-04T14:25:32.000Z',
        DeployedBy: {Username: 'dev@mycompany.com'},
        Error: null,
        Id: '0acEE0000004D1ZYAU',
      },
      ExternalServiceRegistration: {Id: '0ES0x00000ABC456', IsActive: true},
    });

    expect(result).to.deep.equal({
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
    });
  });

  it('omits currentBuild and treats a null ExternalServiceRegistration as not registered', () => {
    const result = toComputeAppSummary(activeRecord);

    expect(result.currentBuild).to.be.undefined;
    expect(result.externalServiceId).to.be.undefined;
    expect(result.externalServiceRegistered).to.be.false;
    expect(result.externalServiceActive).to.be.undefined;
  });

  it('maps null Description and StatusReason to undefined', () => {
    const result = toComputeAppSummary({
      ...activeRecord,
      Description: null,
      StatusReason: 'Buildpack detection failed.',
    });

    expect(result.description).to.be.undefined;
    expect(result.statusReason).to.equal('Buildpack detection failed.');
  });
});

describe('computeQuery.pickHerokuAppId', () => {
  it('returns the record ExternalAppIdentifier when present', () => {
    expect(pickHerokuAppId({...activeRecord, ExternalAppIdentifier: 'a1b2c3d4-heroku-app-id'})).to.equal(
      'a1b2c3d4-heroku-app-id',
    );
  });

  it('returns undefined without falling back to DeveloperName when ExternalAppIdentifier is missing', () => {
    expect(pickHerokuAppId(activeRecord)).to.be.undefined;
  });

  it('returns undefined when ExternalAppIdentifier is explicitly null', () => {
    expect(pickHerokuAppId({...activeRecord, ExternalAppIdentifier: null})).to.be.undefined;
  });
});

describe('computeQuery.requireHerokuAppId', () => {
  it('returns the Heroku app id when present', () => {
    expect(
      requireHerokuAppId({...activeRecord, ExternalAppIdentifier: 'a1b2c3d4-heroku-app-id'}, 'CreditRatingScorer'),
    ).to.equal('a1b2c3d4-heroku-app-id');
  });

  it('throws error.herokuAppIdentifierUnavailable, naming the app, when ExternalAppIdentifier is missing', () => {
    try {
      requireHerokuAppId(activeRecord, 'CreditRatingScorer');
      expect.fail('expected requireHerokuAppId to throw');
    } catch (error) {
      expect((error as Error).message).to.include('CreditRatingScorer');
      expect((error as Error).message).to.include("doesn't have a Heroku app identifier yet");
    }
  });
});

describe('computeQuery.resolveHerokuAppId', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('queries the app and returns its Heroku app id', async () => {
    const singleRecordQuery = sinon
      .stub()
      .resolves({...activeRecord, ExternalAppIdentifier: 'a1b2c3d4-heroku-app-id'});
    const connection = {singleRecordQuery} as unknown as Connection;

    const result = await resolveHerokuAppId(connection, 'CreditRatingScorer');

    expect(result).to.equal('a1b2c3d4-heroku-app-id');
  });

  it('throws error.herokuAppIdentifierUnavailable when the queried record has no Heroku app id', async () => {
    const singleRecordQuery = sinon.stub().resolves(activeRecord);
    const connection = {singleRecordQuery} as unknown as Connection;

    try {
      await resolveHerokuAppId(connection, 'CreditRatingScorer');
      expect.fail('expected resolveHerokuAppId to throw');
    } catch (error) {
      expect((error as Error).message).to.include("doesn't have a Heroku app identifier yet");
    }
  });

  it('propagates the underlying appNotFoundInOrg error when the app does not exist in the org', async () => {
    const singleRecordQuery = sinon.stub().rejects(new SfError('No records found', 'SingleRecordQuery_NoRecords'));
    const connection = {singleRecordQuery} as unknown as Connection;

    try {
      await resolveHerokuAppId(connection, 'NeverDeployed');
      expect.fail('expected resolveHerokuAppId to throw');
    } catch (error) {
      expect((error as Error).message).to.include('No compute app named NeverDeployed was found in the org');
    }
  });
});
