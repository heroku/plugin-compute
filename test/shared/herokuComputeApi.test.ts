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
  fetchComputeFormationViaHeroku,
  fetchComputeBuildOutputViaHeroku,
  scaleComputeFormationViaHeroku,
  createComputeLogSessionViaHeroku,
} from '../../src/shared/herokuComputeApi.js';

const TOKEN = 'shh-secret-token';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

// Multiple Heroku calls can happen in one façade call (e.g. list builds, then fetch that build's
// output stream) -- route by URL substring rather than a single fixed response. The openapi-fetch
// client calls pass a Request object as the first fetch() arg; fetchHerokuBuildOutputStream's raw
// fetch() call passes a plain URL string -- handle both.
function stubFetchByUrl(responses: Array<[string, Response]>): sinon.SinonStub {
  return sinon.stub(globalThis, 'fetch').callsFake(async (input) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    const match = responses.find(([substring]) => url.includes(substring));
    if (!match) {
      throw new Error(`Unexpected fetch to ${url}`);
    }
    return match[1];
  });
}

describe('herokuComputeApi.fetchComputeFormationViaHeroku', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('maps Heroku formation records to the summary shape', async () => {
    /* eslint-disable camelcase -- dyno_size is Heroku's Formation field name */
    stubFetchByUrl([
      [
        '/formation',
        jsonResponse([
          { type: 'web', quantity: 2, dyno_size: { id: 'sz1', name: 'Standard-1X' } },
          { type: 'worker', quantity: 1, dyno_size: undefined },
        ]),
      ],
    ]);
    /* eslint-enable camelcase */

    const result = await fetchComputeFormationViaHeroku(TOKEN, { name: 'my-app' });

    expect(result).to.deep.equal([
      { type: 'web', dynoSize: 'Standard-1X', quantity: 2 },
      { type: 'worker', dynoSize: undefined, quantity: 1 },
    ]);
  });

  it('throws error.herokuAppNotFound on a 404', async () => {
    stubFetchByUrl([['/formation', jsonResponse({ id: 'not_found', message: "Couldn't find that app." }, 404)]]);

    try {
      await fetchComputeFormationViaHeroku(TOKEN, { name: 'missing-app' });
      expect.fail('expected fetchComputeFormationViaHeroku to throw');
    } catch (err) {
      expect((err as Error).message).to.include('missing-app');
      expect((err as Error).message).to.not.include(TOKEN);
    }
  });

  it('throws error.herokuAuthFailed on a 401/403', async () => {
    stubFetchByUrl([['/formation', new Response('forbidden', { status: 403 })]]);

    try {
      await fetchComputeFormationViaHeroku(TOKEN, { name: 'my-app' });
      expect.fail('expected fetchComputeFormationViaHeroku to throw');
    } catch (err) {
      expect((err as Error).message).to.include('rejected the request');
      expect((err as Error).message).to.not.include(TOKEN);
    }
  });

  it('throws error.herokuApiRequestFailed on any other failure', async () => {
    stubFetchByUrl([['/formation', new Response('server error', { status: 500 })]]);

    try {
      await fetchComputeFormationViaHeroku(TOKEN, { name: 'my-app' });
      expect.fail('expected fetchComputeFormationViaHeroku to throw');
    } catch (err) {
      expect((err as Error).message).to.include("Couldn't reach the Heroku Platform API");
      expect((err as Error).message).to.not.include(TOKEN);
    }
  });

  // A network-level failure (DNS/connection refused/etc.) makes the underlying fetch() call
  // itself reject rather than resolve with a non-2xx Response -- so openapi-fetch's client.GET
  // never produces the { error, response } shape that toHerokuApiError() branches on, and the
  // rejection propagates out of listHerokuFormation as a plain Error. throwHerokuComputeError's
  // `err instanceof HerokuApiError` checks must fall through cleanly to the generic
  // error.herokuApiRequestFailed classification for this case too, without crashing on
  // err.status or leaking anything from the raw network error into the user-facing message.
  it('throws error.herokuApiRequestFailed when the underlying fetch rejects (network failure), not just on a non-2xx response', async () => {
    sinon.stub(globalThis, 'fetch').rejects(new TypeError('fetch failed'));

    try {
      await fetchComputeFormationViaHeroku(TOKEN, { name: 'my-app' });
      expect.fail('expected fetchComputeFormationViaHeroku to throw');
    } catch (err) {
      expect((err as Error).message).to.include("Couldn't reach the Heroku Platform API");
      expect((err as Error).message).to.include('fetch failed');
      expect((err as Error).message).to.not.include(TOKEN);
    }
  });
});

describe('herokuComputeApi.fetchComputeBuildOutputViaHeroku', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('fetches the latest (last) build and returns its output stream text', async () => {
    /* eslint-disable camelcase -- output_stream_url is Heroku's Build field name */
    stubFetchByUrl([
      [
        '/builds',
        jsonResponse([
          { id: 'b1', status: 'succeeded', output_stream_url: 'https://api.heroku.com/streams/b1' },
          { id: 'b2', status: 'succeeded', output_stream_url: 'https://api.heroku.com/streams/b2' },
        ]),
      ],
      ['/streams/b2', new Response('-----> Build succeeded!\n', { status: 200 })],
    ]);
    /* eslint-enable camelcase */

    const result = await fetchComputeBuildOutputViaHeroku(TOKEN, { name: 'my-app' });

    expect(result).to.equal('-----> Build succeeded!\n');
  });

  it('returns undefined when there are no builds yet', async () => {
    stubFetchByUrl([['/builds', jsonResponse([])]]);

    const result = await fetchComputeBuildOutputViaHeroku(TOKEN, { name: 'my-app' });

    expect(result).to.be.undefined;
  });

  it('returns undefined when the latest build has no output_stream_url', async () => {
    stubFetchByUrl([['/builds', jsonResponse([{ id: 'b1', status: 'pending' }])]]);

    const result = await fetchComputeBuildOutputViaHeroku(TOKEN, { name: 'my-app' });

    expect(result).to.be.undefined;
  });

  it('throws error.herokuAppNotFound when the builds list 404s', async () => {
    stubFetchByUrl([['/builds', jsonResponse({ id: 'not_found', message: "Couldn't find that app." }, 404)]]);

    try {
      await fetchComputeBuildOutputViaHeroku(TOKEN, { name: 'missing-app' });
      expect.fail('expected fetchComputeBuildOutputViaHeroku to throw');
    } catch (err) {
      expect((err as Error).message).to.include('missing-app');
    }
  });

  // The builds list call and the output-stream fetch are two separate try/catch blocks in
  // fetchComputeBuildOutputViaHeroku -- this exercises the second one, which none of the tests
  // above do (they either fail the builds list itself or let the stream fetch succeed).
  it('throws error.herokuApiRequestFailed when the builds list succeeds but the output stream fetch fails', async () => {
    /* eslint-disable camelcase -- output_stream_url is Heroku's Build field name */
    stubFetchByUrl([
      [
        '/builds',
        jsonResponse([{ id: 'b1', status: 'succeeded', output_stream_url: 'https://api.heroku.com/streams/b1' }]),
      ],
      ['/streams/b1', new Response('server error', { status: 500 })],
    ]);
    /* eslint-enable camelcase */

    try {
      await fetchComputeBuildOutputViaHeroku(TOKEN, { name: 'my-app' });
      expect.fail('expected fetchComputeBuildOutputViaHeroku to throw');
    } catch (err) {
      expect((err as Error).message).to.include("Couldn't reach the Heroku Platform API");
      expect((err as Error).message).to.not.include(TOKEN);
    }
  });

  // fetchHerokuBuildOutputStream returns undefined on a 404 rather than throwing (build hasn't
  // produced output yet) -- confirm that "not yet available" contract survives the façade layer
  // too, distinct from the "no builds at all" and "build has no output_stream_url" cases above.
  it('returns undefined when the latest build has an output_stream_url but Heroku 404s the stream itself', async () => {
    /* eslint-disable camelcase -- output_stream_url is Heroku's Build field name */
    stubFetchByUrl([
      [
        '/builds',
        jsonResponse([{ id: 'b1', status: 'pending', output_stream_url: 'https://api.heroku.com/streams/b1' }]),
      ],
      ['/streams/b1', new Response('not found', { status: 404 })],
    ]);
    /* eslint-enable camelcase */

    const result = await fetchComputeBuildOutputViaHeroku(TOKEN, { name: 'my-app' });

    expect(result).to.be.undefined;
  });
});

describe('herokuComputeApi.scaleComputeFormationViaHeroku', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('sends dyno_size and quantity and maps the updated formation to the result shape', async () => {
    /* eslint-disable camelcase -- dyno_size is Heroku's Formation field name */
    stubFetchByUrl([
      ['/formation/web', jsonResponse({ type: 'web', quantity: 2, dyno_size: { id: 'sz1', name: 'Standard-1X' } })],
    ]);
    /* eslint-enable camelcase */

    const result = await scaleComputeFormationViaHeroku(TOKEN, {
      name: 'my-app',
      processType: 'web',
      dynoSize: 'Standard-1X',
      quantity: 2,
    });

    expect(result).to.deep.equal({ type: 'web', dynoSize: 'Standard-1X', quantity: 2 });
  });

  // dyno_size/quantity are independently optional on the command's flags -- confirm the request
  // body omits whichever one wasn't passed, rather than sending it as null/0.
  it('omits dyno_size from the request body when only --quantity is passed', async () => {
    const fetchStub = sinon.stub(globalThis, 'fetch').callsFake(async (input) => {
      const request = input as Request;
      const body = await request.clone().json();
      // JSON.stringify drops keys whose value is undefined, so an omitted dyno_size never
      // reaches the wire at all -- confirming its absence here, not just a null/0 placeholder.
      expect(body).to.deep.equal({ quantity: 3 });
      return jsonResponse({ type: 'worker', quantity: 3 });
    });

    const result = await scaleComputeFormationViaHeroku(TOKEN, { name: 'my-app', processType: 'worker', quantity: 3 });

    expect(result).to.deep.equal({ type: 'worker', dynoSize: undefined, quantity: 3 });
    expect(fetchStub.calledOnce).to.equal(true);
  });

  it('throws error.herokuFormationNotFound on a 404, naming both the app and process type', async () => {
    stubFetchByUrl([['/formation/web', jsonResponse({ id: 'not_found', message: "Couldn't find that app." }, 404)]]);

    try {
      await scaleComputeFormationViaHeroku(TOKEN, { name: 'missing-app', processType: 'web', quantity: 1 });
      expect.fail('expected scaleComputeFormationViaHeroku to throw');
    } catch (err) {
      expect((err as Error).message).to.include('missing-app');
      expect((err as Error).message).to.include('web');
      expect((err as Error).message).to.not.include(TOKEN);
    }
  });

  // Reuses error.herokuAuthFailed (not a scale-specific variant) since scale does have an
  // org-mediated fallback now -- unsetting HEROKU_API_TOKEN switches scale.ts back to the
  // Connect API path -- unlike when this test was first written.
  it('throws error.herokuAuthFailed on a 401/403', async () => {
    stubFetchByUrl([['/formation/web', new Response('forbidden', { status: 403 })]]);

    try {
      await scaleComputeFormationViaHeroku(TOKEN, { name: 'my-app', processType: 'web', quantity: 1 });
      expect.fail('expected scaleComputeFormationViaHeroku to throw');
    } catch (err) {
      expect((err as Error).message).to.include('rejected the request');
      expect((err as Error).message).to.not.include(TOKEN);
    }
  });

  it('throws error.herokuApiRequestFailed on any other failure', async () => {
    stubFetchByUrl([['/formation/web', new Response('server error', { status: 500 })]]);

    try {
      await scaleComputeFormationViaHeroku(TOKEN, { name: 'my-app', processType: 'web', quantity: 1 });
      expect.fail('expected scaleComputeFormationViaHeroku to throw');
    } catch (err) {
      expect((err as Error).message).to.include("Couldn't reach the Heroku Platform API");
      expect((err as Error).message).to.not.include(TOKEN);
    }
  });

  // dyno_size/quantity are independently optional -- the sibling test above ("omits dyno_size...")
  // only exercises the --quantity-only direction. Confirm the other direction too: when only
  // --dyno-size is passed, quantity must be omitted from the wire body rather than sent as
  // null/0/NaN.
  it('omits quantity from the request body when only --dyno-size is passed', async () => {
    const fetchStub = sinon.stub(globalThis, 'fetch').callsFake(async (input) => {
      const request = input as Request;
      const body = await request.clone().json();
      // eslint-disable-next-line camelcase -- dyno_size is Heroku's FormationUpdateRequest field name
      expect(body).to.deep.equal({ dyno_size: { name: 'Standard-2X' } });
      // eslint-disable-next-line camelcase -- dyno_size is Heroku's Formation field name
      return jsonResponse({ type: 'web', quantity: 1, dyno_size: { id: 'sz2', name: 'Standard-2X' } });
    });

    const result = await scaleComputeFormationViaHeroku(TOKEN, {
      name: 'my-app',
      processType: 'web',
      dynoSize: 'Standard-2X',
    });

    expect(result).to.deep.equal({ type: 'web', dynoSize: 'Standard-2X', quantity: 1 });
    expect(fetchStub.calledOnce).to.equal(true);
  });

  // The catch block narrows on `err instanceof HerokuApiError` to classify 404/401/403 before
  // falling through to throwHerokuComputeError -- mirrors fetchComputeFormationViaHeroku's
  // "network failure" test, which exercises the same instanceof-narrowing hazard on the sibling
  // function directly above this one in the file. A raw fetch rejection (not a HerokuApiError)
  // must fall through cleanly to error.herokuApiRequestFailed without crashing on err.status.
  it('throws error.herokuApiRequestFailed when the underlying fetch rejects (network failure), not just on a non-2xx response', async () => {
    sinon.stub(globalThis, 'fetch').rejects(new TypeError('fetch failed'));

    try {
      await scaleComputeFormationViaHeroku(TOKEN, { name: 'my-app', processType: 'web', quantity: 1 });
      expect.fail('expected scaleComputeFormationViaHeroku to throw');
    } catch (err) {
      expect((err as Error).message).to.include("Couldn't reach the Heroku Platform API");
      expect((err as Error).message).to.include('fetch failed');
      expect((err as Error).message).to.not.include(TOKEN);
    }
  });
});

describe('herokuComputeApi.createComputeLogSessionViaHeroku', () => {
  afterEach(() => {
    sinon.restore();
  });

  it('creates a log session and maps logplex_url to logplexUrl', async () => {
    stubFetchByUrl([
      [
        '/log-sessions',
        // eslint-disable-next-line camelcase -- logplex_url is Heroku's LogSession field name
        jsonResponse({ id: 'sess1', logplex_url: 'https://logplex.heroku.com/sessions/abc?srv=1' }),
      ],
    ]);

    const result = await createComputeLogSessionViaHeroku(TOKEN, { name: 'my-app', lines: 100, tail: false });

    expect(result).to.deep.equal({ logplexUrl: 'https://logplex.heroku.com/sessions/abc?srv=1' });
  });

  it('throws error.herokuApiRequestFailed when Heroku omits logplex_url', async () => {
    stubFetchByUrl([['/log-sessions', jsonResponse({ id: 'sess1' })]]);

    try {
      await createComputeLogSessionViaHeroku(TOKEN, { name: 'my-app' });
      expect.fail('expected createComputeLogSessionViaHeroku to throw');
    } catch (err) {
      expect((err as Error).message).to.include('logplex_url');
    }
  });

  it('throws error.herokuAppNotFound when the app is not found', async () => {
    stubFetchByUrl([['/log-sessions', jsonResponse({ id: 'not_found', message: "Couldn't find that app." }, 404)]]);

    try {
      await createComputeLogSessionViaHeroku(TOKEN, { name: 'missing-app' });
      expect.fail('expected createComputeLogSessionViaHeroku to throw');
    } catch (err) {
      expect((err as Error).message).to.include('missing-app');
    }
  });

  // throwHerokuComputeError's generic branch is `err instanceof Error ? err.message : String(err)`
  // -- mirrors computeQuery.listComputeApps's "wraps a non-Error throw" test for the same reason:
  // a rejected non-Error value (e.g. a bare string, which is valid JS even if not valid Heroku
  // client behavior) must not crash the classification logic.
  it('does not crash when the underlying call rejects with a non-Error value', async () => {
    sinon.stub(globalThis, 'fetch').callsFake(async () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error, no-throw-literal
      throw 'boom';
    });

    try {
      await createComputeLogSessionViaHeroku(TOKEN, { name: 'my-app' });
      expect.fail('expected createComputeLogSessionViaHeroku to throw');
    } catch (err) {
      expect((err as Error).message).to.include('boom');
    }
  });
});
