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
import { SfError, type Connection } from '@salesforce/core';
import { queryComputeApp } from '../../src/shared/computeQuery.js';

const activeRecord = {
  Id: '0abEE0000004CqYYAU',
  DeveloperName: 'LeaseAgreementParser',
  MasterLabel: 'Lease Agreement Parser',
  Description: 'Parses lease agreements.',
  Status: 'ACTIVE' as const,
  StatusReason: null,
  CurrentBuild: null,
  ExternalServiceRegistration: null,
};

describe('computeQuery.queryComputeApp', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('queries PlatformComputeApp via the Tooling API with the CurrentBuild and ExternalServiceRegistration relationship fields', async () => {
    const singleRecordQuery = sinon.stub().resolves(activeRecord);
    const connection = { singleRecordQuery } as unknown as Connection;

    const result = await queryComputeApp(connection, 'LeaseAgreementParser');

    expect(result).to.deep.equal(activeRecord);
    expect(singleRecordQuery.calledOnce).to.be.true;
    const [soql, options] = singleRecordQuery.firstCall.args as [string, { tooling?: boolean }];
    expect(soql).to.include('FROM PlatformComputeApp');
    expect(soql).to.include("WHERE DeveloperName = 'LeaseAgreementParser'");
    expect(soql).to.include('CurrentBuild.BuildStatus');
    expect(soql).to.include('CurrentBuild.DeployedBy.Username');
    expect(soql).to.include('ExternalServiceRegistration.IsActive');
    expect(options).to.deep.equal({ tooling: true });
  });

  it('maps a zero-record result to a deploy-hint error with the name filled into both the message and the actions', async () => {
    const singleRecordQuery = sinon.stub().rejects(new SfError('No records found', 'SingleRecordQuery_NoRecords'));
    const connection = { singleRecordQuery } as unknown as Connection;

    try {
      await queryComputeApp(connection, 'NeverDeployed');
      expect.fail('expected queryComputeApp to throw');
    } catch (err) {
      const e = err as SfError;
      expect(e.message).to.include('No compute app named NeverDeployed was found in the org');
      const actions = e.actions ?? [];
      expect(actions.join('\n')).to.include('--name NeverDeployed');
      expect(actions.join('\n')).to.not.include('%s');
    }
  });

  it('maps a multiple-record result to an ambiguous-name error', async () => {
    const singleRecordQuery = sinon
      .stub()
      .rejects(new SfError('Multiple records found', 'SingleRecordQuery_MultipleRecords'));
    const connection = { singleRecordQuery } as unknown as Connection;

    try {
      await queryComputeApp(connection, 'LeaseAgreementParser');
      expect.fail('expected queryComputeApp to throw');
    } catch (err) {
      expect((err as Error).message).to.include('Found more than one compute app named LeaseAgreementParser');
    }
  });

  it('wraps an unexpected Error-typed query failure', async () => {
    const singleRecordQuery = sinon.stub().rejects(new Error('INVALID_SESSION_ID'));
    const connection = { singleRecordQuery } as unknown as Connection;

    try {
      await queryComputeApp(connection, 'LeaseAgreementParser');
      expect.fail('expected queryComputeApp to throw');
    } catch (err) {
      expect((err as Error).message).to.include("Couldn't query compute app details: INVALID_SESSION_ID");
    }
  });

  it('wraps a non-Error throw (e.g. a rejected string) without crashing', async () => {
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- deliberately non-Error, to test queryComputeApp's non-Error fallback
    const singleRecordQuery = sinon.stub().callsFake(() => Promise.reject('INVALID_SESSION_ID'));
    const connection = { singleRecordQuery } as unknown as Connection;

    try {
      await queryComputeApp(connection, 'LeaseAgreementParser');
      expect.fail('expected queryComputeApp to throw');
    } catch (err) {
      expect((err as Error).message).to.include("Couldn't query compute app details: INVALID_SESSION_ID");
    }
  });
});
