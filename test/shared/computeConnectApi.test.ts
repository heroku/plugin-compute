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
import type { Connection } from '@salesforce/core';
import { uploadComputeSource, createComputeLogSession } from '../../src/shared/computeConnectApi.js';

describe('computeConnectApi.uploadComputeSource', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('POSTs a multipart form to /connect/compute/source', async () => {
    const expected = {
      platformComputeId: '0abEE0000004CqYYAU',
      buildId: '0acEE0000004D1ZYAU',
      sourceBlobSize: 12,
      uploadedAt: '2026-08-31T00:00:00.000Z',
    };
    const request = sinon.stub().resolves(expected);
    const connection = { request } as unknown as Connection;

    const result = await uploadComputeSource(connection, {
      name: 'CreditRatingScorer',
      bundle: Buffer.from('fake-tarball-contents'),
    });

    expect(result).to.deep.equal(expected);
    expect(request.calledOnce).to.be.true;
    const [httpRequest] = request.firstCall.args as [{ method: string; url: string; headers: Record<string, string> }];
    expect(httpRequest.method).to.equal('POST');
    expect(httpRequest.url).to.equal('/connect/compute/source');
    expect(httpRequest.headers['content-type']).to.include('multipart/form-data');
  });

  it('translates a failed request into a createError-style message', async () => {
    const request = sinon.stub().rejects(new Error('socket hang up'));
    const connection = { request } as unknown as Connection;

    try {
      await uploadComputeSource(connection, { name: 'CreditRatingScorer', bundle: Buffer.from('x') });
      expect.fail('expected uploadComputeSource to throw');
    } catch (err) {
      expect((err as Error).message).to.include('socket hang up');
      expect((err as Error).message).to.include('Connect API');
    }
  });
});

describe('computeConnectApi.createComputeLogSession', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('POSTs a JSON body to /connect/compute/logs/session and returns the logplexUrl', async () => {
    const expected = { logplexUrl: 'https://logplex.heroku.com/sessions/abc?srv=1' };
    const request = sinon.stub().resolves(expected);
    const connection = { request } as unknown as Connection;

    const result = await createComputeLogSession(connection, { name: 'CreditRatingScorer', lines: 100, tail: false });

    expect(result).to.deep.equal(expected);
    expect(request.calledOnce).to.be.true;
    const [httpRequest] = request.firstCall.args as [{ method: string; url: string; body: string }];
    expect(httpRequest.method).to.equal('POST');
    expect(httpRequest.url).to.equal('/connect/compute/logs/session');
    expect(JSON.parse(httpRequest.body)).to.deep.equal({ name: 'CreditRatingScorer', lines: 100, tail: false });
  });

  it('wraps a failed session-creation request, including a 404, as a hard error', async () => {
    const request = sinon
      .stub()
      .rejects(Object.assign(new Error('Not Found'), { name: 'ERROR_HTTP_404', errorCode: 'ERROR_HTTP_404' }));
    const connection = { request } as unknown as Connection;

    try {
      await createComputeLogSession(connection, { name: 'CreditRatingScorer' });
      expect.fail('expected createComputeLogSession to throw');
    } catch (err) {
      expect((err as Error).message).to.include("Couldn't create a log session");
      expect((err as Error).message).to.include('Not Found');
    }
  });
});
