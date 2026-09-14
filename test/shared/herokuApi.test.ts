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
import {
  createHerokuClient,
  getHerokuApiToken,
  HerokuApiError,
  listHerokuFormation,
  updateHerokuFormation,
  getHerokuConfigVars,
  updateHerokuConfigVars,
  listHerokuBuilds,
  createHerokuLogSession,
  fetchHerokuBuildOutputStream,
} from '../../src/shared/herokuApi.js';

const TOKEN = 'shh-secret-token';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

// openapi-fetch's client.GET/POST call fetch(request: Request, requestInitExt), not
// fetch(url, init) -- so assertions on the outgoing request read from the captured Request object.
function stubFetchCapturingRequest(response: Response): {
  fetchStub: sinon.SinonStub;
  getRequest: () => Request | undefined;
} {
  let captured: Request | undefined;
  const fetchStub = sinon.stub(globalThis, 'fetch').callsFake(async (input) => {
    captured = input as Request;
    return response;
  });
  return { fetchStub, getRequest: () => captured };
}

describe('herokuApi.getHerokuApiToken', () => {
  afterEach(() => {
    delete process.env.HEROKU_API_TOKEN;
  });

  it('returns undefined when HEROKU_API_TOKEN is unset', () => {
    delete process.env.HEROKU_API_TOKEN;
    expect(getHerokuApiToken()).to.be.undefined;
  });

  it('returns the token value when set', () => {
    process.env.HEROKU_API_TOKEN = TOKEN;
    expect(getHerokuApiToken()).to.equal(TOKEN);
  });
});

describe('herokuApi.HerokuApiError', () => {
  it('carries the status and message as separate fields', () => {
    const err = new HerokuApiError(404, "Couldn't find that app.");
    expect(err.status).to.equal(404);
    expect(err.message).to.equal("Couldn't find that app.");
    expect(err.name).to.equal('HerokuApiError');
    expect(err).to.be.instanceOf(Error);
  });
});

describe('herokuApi.listHerokuFormation', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('GETs /apps/{app_id_or_name}/formation with the Bearer token and Accept header', async () => {
    // eslint-disable-next-line camelcase -- dyno_size is Heroku's Formation field name
    const formationRecord = { type: 'web', quantity: 1, dyno_size: { id: 'sz1', name: 'Standard-1X' } };
    const { getRequest } = stubFetchCapturingRequest(jsonResponse([formationRecord]));
    const client = createHerokuClient(TOKEN);

    const result = await listHerokuFormation(client, 'my-app');

    expect(result).to.deep.equal([formationRecord]);
    const request = getRequest();
    expect(request?.url).to.equal('https://api.heroku.com/apps/my-app/formation');
    expect(request?.method).to.equal('GET');
    expect(request?.headers.get('authorization')).to.equal(`Bearer ${TOKEN}`);
    expect(request?.headers.get('accept')).to.equal('application/vnd.heroku+json; version=3');
  });

  it('throws a HerokuApiError built from the HerokuError body on a non-2xx response', async () => {
    stubFetchCapturingRequest(jsonResponse({ id: 'not_found', message: "Couldn't find that app." }, 404));
    const client = createHerokuClient(TOKEN);

    try {
      await listHerokuFormation(client, 'missing-app');
      expect.fail('expected listHerokuFormation to throw');
    } catch (err) {
      expect(err).to.be.instanceOf(HerokuApiError);
      expect((err as HerokuApiError).status).to.equal(404);
      expect((err as HerokuApiError).message).to.equal("Couldn't find that app.");
    }
  });

  it('falls back to a bare HTTP {status} message and never leaks the bearer token when the body is not a HerokuError', async () => {
    stubFetchCapturingRequest(new Response('unauthorized', { status: 401 }));
    const client = createHerokuClient(TOKEN);

    try {
      await listHerokuFormation(client, 'my-app');
      expect.fail('expected listHerokuFormation to throw');
    } catch (err) {
      expect((err as Error).message).to.equal('HTTP 401');
      expect((err as Error).message).to.not.include(TOKEN);
    }
  });
});

describe('herokuApi.updateHerokuFormation', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('PATCHes /apps/{app_id_or_name}/formation/{formation_id_or_type} with the request body', async () => {
    // eslint-disable-next-line camelcase -- dyno_size is Heroku's Formation field name
    const updated = { type: 'web', quantity: 2, dyno_size: { id: 'sz1', name: 'Standard-1X' } };
    const { getRequest } = stubFetchCapturingRequest(jsonResponse(updated));
    const client = createHerokuClient(TOKEN);

    const result = await updateHerokuFormation(client, 'my-app', 'web', {
      // eslint-disable-next-line camelcase -- dyno_size is Heroku's FormationUpdateRequest field name
      dyno_size: { name: 'Standard-1X' },
      quantity: 2,
    });

    expect(result).to.deep.equal(updated);
    const request = getRequest();
    expect(request?.url).to.equal('https://api.heroku.com/apps/my-app/formation/web');
    expect(request?.method).to.equal('PATCH');
    expect(request?.headers.get('authorization')).to.equal(`Bearer ${TOKEN}`);
    expect(request?.headers.get('accept')).to.equal('application/vnd.heroku+json; version=3');
    // eslint-disable-next-line camelcase -- dyno_size is Heroku's FormationUpdateRequest field name
    expect(await request?.clone().json()).to.deep.equal({ dyno_size: { name: 'Standard-1X' }, quantity: 2 });
  });

  it('throws a HerokuApiError built from the HerokuError body on a non-2xx response', async () => {
    stubFetchCapturingRequest(jsonResponse({ id: 'not_found', message: "Couldn't find that app." }, 404));
    const client = createHerokuClient(TOKEN);

    try {
      await updateHerokuFormation(client, 'missing-app', 'web', { quantity: 2 });
      expect.fail('expected updateHerokuFormation to throw');
    } catch (err) {
      expect(err).to.be.instanceOf(HerokuApiError);
      expect((err as HerokuApiError).status).to.equal(404);
    }
  });

  it('falls back to a bare HTTP {status} message and never leaks the bearer token when the body is not a HerokuError', async () => {
    stubFetchCapturingRequest(new Response('forbidden', { status: 403 }));
    const client = createHerokuClient(TOKEN);

    try {
      await updateHerokuFormation(client, 'my-app', 'web', { quantity: 2 });
      expect.fail('expected updateHerokuFormation to throw');
    } catch (err) {
      expect((err as Error).message).to.equal('HTTP 403');
      expect((err as Error).message).to.not.include(TOKEN);
    }
  });
});

describe('herokuApi.getHerokuConfigVars', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('GETs /apps/{app_id_or_name}/config-vars with the Bearer token and Accept header', async () => {
    const configVars = { STRIPE_KEY: 'sk_live_abc123', LOG_LEVEL: 'info' };
    const { getRequest } = stubFetchCapturingRequest(jsonResponse(configVars));
    const client = createHerokuClient(TOKEN);

    const result = await getHerokuConfigVars(client, 'my-app');

    expect(result).to.deep.equal(configVars);
    const request = getRequest();
    expect(request?.url).to.equal('https://api.heroku.com/apps/my-app/config-vars');
    expect(request?.method).to.equal('GET');
    expect(request?.headers.get('authorization')).to.equal(`Bearer ${TOKEN}`);
    expect(request?.headers.get('accept')).to.equal('application/vnd.heroku+json; version=3');
  });

  it('throws a HerokuApiError built from the HerokuError body on a non-2xx response', async () => {
    stubFetchCapturingRequest(jsonResponse({ id: 'not_found', message: "Couldn't find that app." }, 404));
    const client = createHerokuClient(TOKEN);

    try {
      await getHerokuConfigVars(client, 'missing-app');
      expect.fail('expected getHerokuConfigVars to throw');
    } catch (err) {
      expect(err).to.be.instanceOf(HerokuApiError);
      expect((err as HerokuApiError).status).to.equal(404);
      expect((err as HerokuApiError).message).to.equal("Couldn't find that app.");
    }
  });

  it('falls back to a bare HTTP {status} message and never leaks the bearer token when the body is not a HerokuError', async () => {
    stubFetchCapturingRequest(new Response('unauthorized', { status: 401 }));
    const client = createHerokuClient(TOKEN);

    try {
      await getHerokuConfigVars(client, 'my-app');
      expect.fail('expected getHerokuConfigVars to throw');
    } catch (err) {
      expect((err as Error).message).to.equal('HTTP 401');
      expect((err as Error).message).to.not.include(TOKEN);
    }
  });
});

describe('herokuApi.updateHerokuConfigVars', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('PATCHes /apps/{app_id_or_name}/config-vars with the request body', async () => {
    const updated = { STRIPE_KEY: 'sk_live_xyz789' };
    const { getRequest } = stubFetchCapturingRequest(jsonResponse(updated));
    const client = createHerokuClient(TOKEN);

    const result = await updateHerokuConfigVars(client, 'my-app', { STRIPE_KEY: 'sk_live_xyz789', LOG_LEVEL: null });

    expect(result).to.deep.equal(updated);
    const request = getRequest();
    expect(request?.url).to.equal('https://api.heroku.com/apps/my-app/config-vars');
    expect(request?.method).to.equal('PATCH');
    expect(request?.headers.get('authorization')).to.equal(`Bearer ${TOKEN}`);
    expect(request?.headers.get('accept')).to.equal('application/vnd.heroku+json; version=3');
    expect(await request?.clone().json()).to.deep.equal({ STRIPE_KEY: 'sk_live_xyz789', LOG_LEVEL: null });
  });

  it('throws a HerokuApiError built from the HerokuError body on a non-2xx response', async () => {
    stubFetchCapturingRequest(jsonResponse({ id: 'not_found', message: "Couldn't find that app." }, 404));
    const client = createHerokuClient(TOKEN);

    try {
      await updateHerokuConfigVars(client, 'missing-app', { FOO: 'bar' });
      expect.fail('expected updateHerokuConfigVars to throw');
    } catch (err) {
      expect(err).to.be.instanceOf(HerokuApiError);
      expect((err as HerokuApiError).status).to.equal(404);
    }
  });

  it('falls back to a bare HTTP {status} message and never leaks the bearer token when the body is not a HerokuError', async () => {
    stubFetchCapturingRequest(new Response('forbidden', { status: 403 }));
    const client = createHerokuClient(TOKEN);

    try {
      await updateHerokuConfigVars(client, 'my-app', { FOO: 'bar' });
      expect.fail('expected updateHerokuConfigVars to throw');
    } catch (err) {
      expect((err as Error).message).to.equal('HTTP 403');
      expect((err as Error).message).to.not.include(TOKEN);
    }
  });
});

describe('herokuApi.listHerokuBuilds', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('GETs /apps/{app_id_or_name}/builds and returns the parsed builds', async () => {
    /* eslint-disable camelcase -- output_stream_url is Heroku's Build field name */
    const builds = [
      { id: 'b1', status: 'succeeded', output_stream_url: 'https://api.heroku.com/streams/b1' },
      { id: 'b2', status: 'succeeded', output_stream_url: 'https://api.heroku.com/streams/b2' },
    ];
    /* eslint-enable camelcase */
    const { getRequest } = stubFetchCapturingRequest(jsonResponse(builds));
    const client = createHerokuClient(TOKEN);

    const result = await listHerokuBuilds(client, 'my-app');

    expect(result).to.deep.equal(builds);
    expect(getRequest()?.url).to.equal('https://api.heroku.com/apps/my-app/builds');
  });

  it('wraps a non-2xx response as a HerokuApiError', async () => {
    stubFetchCapturingRequest(jsonResponse({ id: 'not_found', message: "Couldn't find that app." }, 404));
    const client = createHerokuClient(TOKEN);

    try {
      await listHerokuBuilds(client, 'missing-app');
      expect.fail('expected listHerokuBuilds to throw');
    } catch (err) {
      expect(err).to.be.instanceOf(HerokuApiError);
      expect((err as HerokuApiError).status).to.equal(404);
    }
  });
});

describe('herokuApi.createHerokuLogSession', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('POSTs a JSON body to /apps/{app_id_or_name}/log-sessions and returns the session', async () => {
    // eslint-disable-next-line camelcase -- logplex_url is Heroku's LogSession field name
    const session = { id: 'sess1', logplex_url: 'https://logplex.heroku.com/sessions/abc?srv=1' };
    const { getRequest } = stubFetchCapturingRequest(jsonResponse(session));
    const client = createHerokuClient(TOKEN);

    const result = await createHerokuLogSession(client, 'my-app', { lines: 100, tail: false });

    expect(result).to.deep.equal(session);
    const request = getRequest();
    expect(request?.url).to.equal('https://api.heroku.com/apps/my-app/log-sessions');
    expect(request?.method).to.equal('POST');
    expect(await request?.clone().json()).to.deep.equal({ lines: 100, tail: false });
  });

  it('wraps a non-2xx response as a HerokuApiError', async () => {
    stubFetchCapturingRequest(new Response('forbidden', { status: 403 }));
    const client = createHerokuClient(TOKEN);

    try {
      await createHerokuLogSession(client, 'my-app', {});
      expect.fail('expected createHerokuLogSession to throw');
    } catch (err) {
      expect((err as HerokuApiError).status).to.equal(403);
      expect((err as Error).message).to.equal('HTTP 403');
    }
  });
});

describe('herokuApi.fetchHerokuBuildOutputStream', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('GETs the output stream URL with the Bearer token and returns the text body', async () => {
    // fetchHerokuBuildOutputStream calls raw fetch(url, init) directly, unlike the openapi-fetch
    // client calls above which pass a Request object as the first arg.
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    sinon.stub(globalThis, 'fetch').callsFake(async (input, init) => {
      capturedUrl = input as string;
      capturedInit = init;
      return new Response('-----> Build succeeded!\n', { status: 200 });
    });

    const result = await fetchHerokuBuildOutputStream('https://api.heroku.com/streams/b1', TOKEN);

    expect(result).to.equal('-----> Build succeeded!\n');
    expect(capturedUrl).to.equal('https://api.heroku.com/streams/b1');
    expect(new Headers(capturedInit?.headers).get('authorization')).to.equal(`Bearer ${TOKEN}`);
  });

  it('returns undefined on a 404 (build has not produced output yet)', async () => {
    sinon.stub(globalThis, 'fetch').resolves(new Response('not found', { status: 404 }));

    const result = await fetchHerokuBuildOutputStream('https://api.heroku.com/streams/b1', TOKEN);

    expect(result).to.be.undefined;
  });

  it('throws a bare HTTP {status} HerokuApiError on any other non-2xx response, never leaking the token', async () => {
    sinon.stub(globalThis, 'fetch').resolves(new Response('gone', { status: 410 }));

    try {
      await fetchHerokuBuildOutputStream('https://api.heroku.com/streams/b1', TOKEN);
      expect.fail('expected fetchHerokuBuildOutputStream to throw');
    } catch (err) {
      expect(err).to.be.instanceOf(HerokuApiError);
      expect((err as HerokuApiError).status).to.equal(410);
      expect((err as Error).message).to.equal('HTTP 410');
      expect((err as Error).message).to.not.include(TOKEN);
    }
  });
});
