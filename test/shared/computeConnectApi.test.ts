import type {Connection} from '@salesforce/core';

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

import {downloadComputeSource, uploadComputeSource} from '../../src/shared/computeConnectApi.js';

describe('computeConnectApi.uploadComputeSource', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('POSTs a multipart form to /connect/compute/source', async () => {
    const expected = {
      buildId: '0acEE0000004D1ZYAU',
      platformComputeId: '0abEE0000004CqYYAU',
      sourceBlobSize: 12,
      uploadedAt: '2026-08-31T00:00:00.000Z',
    };
    const request = sinon.stub().resolves(expected);
    const connection = {request} as unknown as Connection;

    const result = await uploadComputeSource(connection, {
      bundle: Buffer.from('fake-tarball-contents'),
      name: 'CreditRatingScorer',
    });

    expect(result).to.deep.equal(expected);
    expect(request.calledOnce).to.be.true;
    const [httpRequest] = request.firstCall.args as [{headers: Record<string, string>; method: string; url: string}];
    expect(httpRequest.method).to.equal('POST');
    expect(httpRequest.url).to.equal('/connect/compute/source');
    expect(httpRequest.headers['content-type']).to.include('multipart/form-data');
  });

  it('translates a failed request into a createError-style message', async () => {
    const request = sinon.stub().rejects(new Error('socket hang up'));
    const connection = {request} as unknown as Connection;

    try {
      await uploadComputeSource(connection, {bundle: Buffer.from('x'), name: 'CreditRatingScorer'});
      expect.fail('expected uploadComputeSource to throw');
    } catch (error) {
      expect((error as Error).message).to.include('socket hang up');
      expect((error as Error).message).to.include('Connect API');
    }
  });
});

describe('computeConnectApi.downloadComputeSource', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('GETs /connect/compute/{app_id_or_name}/source with { encoding: binary } and returns the exact original bytes', async () => {
    // Bytes >0x7F are where UTF-8 decoding would corrupt a binary gzip payload -- this is a
    // real byte-content round-trip assertion, not just a "was called" assertion.
    const original = Buffer.from([0x1F, 0x8B, 0x00, 0xFF, 0x80, 0x41, 0x00, 0xDE, 0xAD, 0xBE, 0xEF]);
    const request = sinon.stub().resolves(original.toString('binary'));
    const connection = {request} as unknown as Connection;

    const result = await downloadComputeSource(connection, {appIdOrName: 'CreditRatingScorer'});

    expect(Buffer.compare(result, original)).to.equal(0);
    expect(request.calledOnce).to.be.true;
    const [httpRequest, options] = request.firstCall.args as [{method: string; url: string}, {encoding: string}];
    expect(httpRequest.method).to.equal('GET');
    expect(httpRequest.url).to.equal('/connect/compute/CreditRatingScorer/source');
    expect(options).to.deep.equal({encoding: 'binary'});
  });

  it('URL-encodes the app_id_or_name path segment', async () => {
    const request = sinon.stub().resolves('');
    const connection = {request} as unknown as Connection;

    await downloadComputeSource(connection, {appIdOrName: 'my app/1'});

    const [httpRequest] = request.firstCall.args as [{url: string}];
    expect(httpRequest.url).to.equal('/connect/compute/my%20app%2F1/source');
  });

  it('translates a failed request into a createError-style message', async () => {
    const request = sinon.stub().rejects(new Error('socket hang up'));
    const connection = {request} as unknown as Connection;

    try {
      await downloadComputeSource(connection, {appIdOrName: 'CreditRatingScorer'});
      expect.fail('expected downloadComputeSource to throw');
    } catch (error) {
      expect((error as Error).message).to.include('socket hang up');
      expect((error as Error).message).to.include('source');
    }
  });
});
