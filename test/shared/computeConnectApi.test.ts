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
import {
  uploadComputeSource,
  downloadComputeSource,
  createComputeLogSession,
  updateComputeFormation,
  fetchComputeConfigVars,
  updateComputeConfigVars,
} from '../../src/shared/computeConnectApi.js';

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

describe('computeConnectApi.downloadComputeSource', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('GETs /connect/compute/{app_id_or_name}/source with { encoding: binary } and returns the exact original bytes', async () => {
    // Bytes >0x7F are where UTF-8 decoding would corrupt a binary gzip payload -- this is a
    // real byte-content round-trip assertion, not just a "was called" assertion.
    const original = Buffer.from([0x1f, 0x8b, 0x00, 0xff, 0x80, 0x41, 0x00, 0xde, 0xad, 0xbe, 0xef]);
    const request = sinon.stub().resolves(original.toString('binary'));
    const connection = { request } as unknown as Connection;

    const result = await downloadComputeSource(connection, { appIdOrName: 'CreditRatingScorer' });

    expect(Buffer.compare(result, original)).to.equal(0);
    expect(request.calledOnce).to.be.true;
    const [httpRequest, options] = request.firstCall.args as [{ method: string; url: string }, { encoding: string }];
    expect(httpRequest.method).to.equal('GET');
    expect(httpRequest.url).to.equal('/connect/compute/CreditRatingScorer/source');
    expect(options).to.deep.equal({ encoding: 'binary' });
  });

  it('URL-encodes the app_id_or_name path segment', async () => {
    const request = sinon.stub().resolves('');
    const connection = { request } as unknown as Connection;

    await downloadComputeSource(connection, { appIdOrName: 'my app/1' });

    const [httpRequest] = request.firstCall.args as [{ url: string }];
    expect(httpRequest.url).to.equal('/connect/compute/my%20app%2F1/source');
  });

  it('translates a failed request into a createError-style message', async () => {
    const request = sinon.stub().rejects(new Error('socket hang up'));
    const connection = { request } as unknown as Connection;

    try {
      await downloadComputeSource(connection, { appIdOrName: 'CreditRatingScorer' });
      expect.fail('expected downloadComputeSource to throw');
    } catch (err) {
      expect((err as Error).message).to.include('socket hang up');
      expect((err as Error).message).to.include('source');
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

describe('computeConnectApi.updateComputeFormation', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('PATCHes /connect/compute/{app_id_or_name}/formation/{formation_id_or_type} with a Heroku-shaped body, and flattens the response', async () => {
    /* eslint-disable camelcase -- dyno_size mirrors Heroku's Formation field name */
    const request = sinon.stub().resolves({ type: 'web', dyno_size: { name: 'Standard-1X' }, quantity: 2 });
    /* eslint-enable camelcase */
    const connection = { request } as unknown as Connection;

    const result = await updateComputeFormation(connection, {
      app: 'CreditRatingScorer',
      processType: 'web',
      dynoSize: 'Standard-1X',
      quantity: 2,
    });

    expect(result).to.deep.equal({ type: 'web', dynoSize: 'Standard-1X', quantity: 2 });
    expect(request.calledOnce).to.be.true;
    const [httpRequest] = request.firstCall.args as [{ method: string; url: string; body: string }];
    expect(httpRequest.method).to.equal('PATCH');
    expect(httpRequest.url).to.equal('/connect/compute/CreditRatingScorer/formation/web');
    /* eslint-disable-next-line camelcase -- dyno_size mirrors Heroku's FormationUpdateRequest field name */
    expect(JSON.parse(httpRequest.body)).to.deep.equal({ dyno_size: { name: 'Standard-1X' }, quantity: 2 });
  });

  // app/processType land in the URL path, not the request body -- confirm both are escaped so a
  // value containing a slash or other reserved character can't smuggle in an extra path segment.
  it('URL-encodes the app and processType path segments', async () => {
    const request = sinon.stub().resolves({ type: 'web', quantity: 1 });
    const connection = { request } as unknown as Connection;

    await updateComputeFormation(connection, { app: 'my app/1', processType: 'web worker', quantity: 1 });

    const [httpRequest] = request.firstCall.args as [{ url: string }];
    expect(httpRequest.url).to.equal('/connect/compute/my%20app%2F1/formation/web%20worker');
  });

  // dynoSize/quantity are independently optional -- JSON.stringify drops the omitted one entirely
  // rather than sending it as null/0.
  it('omits quantity from the request body when only dynoSize is passed', async () => {
    const request = sinon.stub().resolves({ type: 'web', quantity: 1 });
    const connection = { request } as unknown as Connection;

    await updateComputeFormation(connection, {
      app: 'CreditRatingScorer',
      processType: 'web',
      dynoSize: 'Standard-1X',
    });

    const [httpRequest] = request.firstCall.args as [{ body: string }];
    /* eslint-disable-next-line camelcase -- dyno_size mirrors Heroku's FormationUpdateRequest field name */
    expect(JSON.parse(httpRequest.body)).to.deep.equal({ dyno_size: { name: 'Standard-1X' } });
  });

  // dyno_size is entirely absent from the request when no dynoSize is passed -- JSON.stringify
  // drops the key rather than sending dyno_size: undefined.
  it('omits dyno_size from the request body when only quantity is passed', async () => {
    const request = sinon.stub().resolves({ type: 'worker', quantity: 0 });
    const connection = { request } as unknown as Connection;

    await updateComputeFormation(connection, { app: 'CreditRatingScorer', processType: 'worker', quantity: 0 });

    const [httpRequest] = request.firstCall.args as [{ body: string }];
    expect(JSON.parse(httpRequest.body)).to.deep.equal({ quantity: 0 });
  });

  it('translates a failed request into a createError-style message', async () => {
    const request = sinon.stub().rejects(new Error('socket hang up'));
    const connection = { request } as unknown as Connection;

    try {
      await updateComputeFormation(connection, { app: 'CreditRatingScorer', processType: 'web', quantity: 1 });
      expect.fail('expected updateComputeFormation to throw');
    } catch (err) {
      expect((err as Error).message).to.include('socket hang up');
      expect((err as Error).message).to.include('dyno formation');
    }
  });
});

describe('computeConnectApi.fetchComputeConfigVars', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('GETs /connect/compute/{app_id_or_name}/config-vars', async () => {
    const expected = { LOG_LEVEL: 'info', STRIPE_KEY: 'sk_live_abc123' };
    const request = sinon.stub().resolves(expected);
    const connection = { request } as unknown as Connection;

    const result = await fetchComputeConfigVars(connection, { app: 'CreditRatingScorer' });

    expect(result).to.deep.equal(expected);
    const [httpRequest] = request.firstCall.args as [{ method: string; url: string }];
    expect(httpRequest.method).to.equal('GET');
    expect(httpRequest.url).to.equal('/connect/compute/CreditRatingScorer/config-vars');
  });

  it('URL-encodes the app path segment', async () => {
    const request = sinon.stub().resolves({});
    const connection = { request } as unknown as Connection;

    await fetchComputeConfigVars(connection, { app: 'my app/1' });

    const [httpRequest] = request.firstCall.args as [{ url: string }];
    expect(httpRequest.url).to.equal('/connect/compute/my%20app%2F1/config-vars');
  });

  it('translates a failed request into a createError-style message', async () => {
    const request = sinon.stub().rejects(new Error('socket hang up'));
    const connection = { request } as unknown as Connection;

    try {
      await fetchComputeConfigVars(connection, { app: 'CreditRatingScorer' });
      expect.fail('expected fetchComputeConfigVars to throw');
    } catch (err) {
      expect((err as Error).message).to.include('socket hang up');
      expect((err as Error).message).to.include('config vars');
    }
  });
});

describe('computeConnectApi.updateComputeConfigVars', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('PATCHes /connect/compute/{app_id_or_name}/config-vars and returns the configVars and release', async () => {
    const request = sinon.stub().resolves({ configVars: { STRIPE_KEY: 'sk_live_xyz789' }, release: 11 });
    const connection = { request } as unknown as Connection;

    const result = await updateComputeConfigVars(connection, {
      app: 'CreditRatingScorer',
      updates: { STRIPE_KEY: 'sk_live_xyz789' },
    });

    expect(result).to.deep.equal({ configVars: { STRIPE_KEY: 'sk_live_xyz789' }, release: 11 });
    const [httpRequest] = request.firstCall.args as [{ method: string; url: string; body: string }];
    expect(httpRequest.method).to.equal('PATCH');
    expect(httpRequest.url).to.equal('/connect/compute/CreditRatingScorer/config-vars');
    expect(JSON.parse(httpRequest.body)).to.deep.equal({ STRIPE_KEY: 'sk_live_xyz789' });
  });

  it('sends a null value to unset a config var, and omits release when the response has none', async () => {
    const request = sinon.stub().resolves({ configVars: {} });
    const connection = { request } as unknown as Connection;

    const result = await updateComputeConfigVars(connection, {
      app: 'CreditRatingScorer',
      updates: { LOG_LEVEL: null },
    });

    expect(result).to.deep.equal({ configVars: {}, release: undefined });
    const [httpRequest] = request.firstCall.args as [{ body: string }];
    expect(JSON.parse(httpRequest.body)).to.deep.equal({ LOG_LEVEL: null });
  });

  it('translates a failed request into a createError-style message', async () => {
    const request = sinon.stub().rejects(new Error('socket hang up'));
    const connection = { request } as unknown as Connection;

    try {
      await updateComputeConfigVars(connection, { app: 'CreditRatingScorer', updates: { FOO: 'bar' } });
      expect.fail('expected updateComputeConfigVars to throw');
    } catch (err) {
      expect((err as Error).message).to.include('socket hang up');
      expect((err as Error).message).to.include('config vars');
    }
  });
});
