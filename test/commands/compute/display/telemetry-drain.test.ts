import type {Mock, MockInstance} from 'vitest';

import {Org} from '@salesforce/core';
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

import TelemetryDrainDisplay from '../../../../src/commands/compute/display/telemetry-drain.js';

// Decode the real Heroku target URL out of the proxy_url query param -- mirrors herokuProxyRequest's
// proxyUrl construction (see config/get.test.ts).
function proxyTarget(url: string): string {
  return new URL(url, 'https://example.com').searchParams.get('proxy_url') ?? '';
}

const DRAIN_ID = '01234567-89ab-cdef-0123-456789abcdef';
const OWNER_APP_ID = 'a1b2c3d4-heroku-app-id';
const OWNER_APP_NAME = 'CreditRatingScorer';

type Drain = {
  exporter?: {endpoint?: string; headers?: Record<string, string>; type?: string};
  id?: string;
  owner?: {id?: string; type?: string};
  signals?: string[];
};

// Keyed by decoded target so the drain fetch, the owner-app resolve, and anything else return
// distinct payloads -- the owner-resolve path is the crux of this command (PR #35).
function stubProxy(requestStub: Mock, opts: {app?: (() => never) | unknown; drain: Drain}): void {
  requestStub.mockImplementation(async (req: {url?: string}) => {
    const target = proxyTarget(req.url ?? '');
    if (target.includes('/telemetry-drains/')) {
      return opts.drain;
    }

    if (target.startsWith('https://api.heroku.com/apps/')) {
      if (typeof opts.app === 'function') {
        return (opts.app as () => never)();
      }

      return opts.app ?? {};
    }

    return {};
  });
}

function ownerCall(requestStub: Mock): undefined | unknown[] {
  return requestStub.mock.calls.find(call => {
    const req = call[0] as undefined | {url?: string};
    return req?.url !== undefined && proxyTarget(req.url) === `https://api.heroku.com/apps/${OWNER_APP_ID}`;
  });
}

const fullDrain: Drain = {
  id: DRAIN_ID,
  owner: {id: OWNER_APP_ID, type: 'app'},
  signals: ['traces', 'logs'],
  exporter: {type: 'otlp', endpoint: 'https://collector.example.com:4317', headers: {'x-api-key': 'secret'}},
};

describe('compute display telemetry-drain', () => {
  const $$ = new TestContext();
  const testOrg = new MockTestOrgData();
  let sfCommandStubs: ReturnType<typeof stubSfCommandUx>;
  let toolingQueryStub: MockInstance;
  let requestStub: Mock;

  beforeEach(async () => {
    sfCommandStubs = stubSfCommandUx($$.SANDBOX);
    await $$.stubAuths(testOrg);

    const org = await Org.create({aliasOrUsername: testOrg.username});
    const connection = org.getConnection();
    // display is purely drain-id driven -- it must never resolve an app through the org (no --name).
    toolingQueryStub = vi.spyOn(connection.tooling, 'query');
    $$.SANDBOX.stub(Org.prototype, 'getConnection').returns(connection);

    requestStub = vi.fn().mockResolvedValue({});
    $$.fakeConnectionRequest = requestStub;
  });

  afterEach(() => {
    process.exitCode = 0;
    $$.restore();
    vi.restoreAllMocks();
  });

  it('renders every detail row (App/Signals/Endpoint/Transport/Headers) for the fetched drain', async () => {
    stubProxy(requestStub, {drain: fullDrain, app: {name: OWNER_APP_NAME, region: {name: 'us'}}});

    await TelemetryDrainDisplay.run([DRAIN_ID, '--target-org', testOrg.username]);

    expect(sfCommandStubs.styledHeader.calledWith('Telemetry Drain')).toBe(true);
    const [{columns, data}] = sfCommandStubs.table.firstCall.args as [
      {columns: string[]; data: Array<{key: string; value: string}>},
    ];
    expect(columns).toEqual(['key', 'value']);
    expect(data).toEqual([
      {key: 'App', value: OWNER_APP_NAME},
      {key: 'Signals', value: 'traces, logs'},
      {key: 'Endpoint', value: 'https://collector.example.com:4317'},
      {key: 'Transport', value: 'gRPC'},
      // The table masks header VALUES (keys stay) so a secret can't leak into scrollback/screenshots.
      {key: 'Headers', value: '{"x-api-key":"<redacted>"}'},
    ]);
    expect(toolingQueryStub).not.toHaveBeenCalled();
  });

  it('GETs the single-drain path, url-encoding the drain id', async () => {
    stubProxy(requestStub, {drain: fullDrain, app: {name: OWNER_APP_NAME}});

    await TelemetryDrainDisplay.run(['a/b c', '--target-org', testOrg.username]);

    const call = requestStub.mock.calls.find(c => {
      const req = c[0] as {url?: string};
      return req.url !== undefined && proxyTarget(req.url).includes('/telemetry-drains/');
    });
    expect(call).toBeDefined();
    expect(proxyTarget((call![0] as {url: string}).url)).toBe('https://api.heroku.com/telemetry-drains/a%2Fb%20c');
  });

  it('labels App with the name resolved from the drain owner (not the positional id) via GET /apps/{owner.id}', async () => {
    stubProxy(requestStub, {drain: fullDrain, app: {name: OWNER_APP_NAME}});

    const result = await TelemetryDrainDisplay.run([DRAIN_ID, '--target-org', testOrg.username]);

    expect(ownerCall(requestStub)).toBeDefined();
    expect(result.app).toBe(OWNER_APP_NAME);
    expect(result.app).not.toBe(DRAIN_ID);
    expect(result.app).not.toBe(OWNER_APP_ID);
    // The raw owner rides through flat so --json can disambiguate what the `app` label collapses.
    expect(result.ownerId).toBe(OWNER_APP_ID);
    expect(result.ownerType).toBe('app');
  });

  it('is best-effort: when the owner-app lookup fails it still succeeds, labelling App with the owner id and not warning', async () => {
    stubProxy(requestStub, {
      drain: fullDrain,
      app() {
        throw Object.assign(new Error("Couldn't find that app."), {data: {id: 'not_found'}});
      },
    });

    const result = await TelemetryDrainDisplay.run([DRAIN_ID, '--target-org', testOrg.username]);

    expect(result.app).toBe(OWNER_APP_ID);
    expect(result.ownerId).toBe(OWNER_APP_ID);
    expect(result.ownerType).toBe('app');
    expect(ownerCall(requestStub)).toBeDefined();
    // #7: the swallowed lookup error is debug-logged, never warned -- a failed label is non-fatal.
    expect(sfCommandStubs.warn.called).toBe(false);
    const [{data}] = sfCommandStubs.table.firstCall.args as [{data: Array<{key: string; value: string}>}];
    expect(data.find(r => r.key === 'App')?.value).toBe(OWNER_APP_ID);
    expect(data.find(r => r.key === 'Signals')?.value).toBe('traces, logs');
  });

  it('does not resolve an app and labels App with the owner id for a space-owned drain', async () => {
    const spaceDrain: Drain = {...fullDrain, owner: {id: 'space-uuid', type: 'space'}};
    stubProxy(requestStub, {drain: spaceDrain});

    const result = await TelemetryDrainDisplay.run([DRAIN_ID, '--target-org', testOrg.username]);

    expect(result.app).toBe('space-uuid');
    expect(result.ownerId).toBe('space-uuid');
    expect(result.ownerType).toBe('space');
    expect(
      requestStub.mock.calls.every(c => !proxyTarget((c[0] as {url?: string}).url ?? '').startsWith('https://api.heroku.com/apps/')),
    ).toBe(true);
  });

  it('falls back to a dash label when the drain has no owner', async () => {
    const ownerlessDrain: Drain = {...fullDrain, owner: undefined};
    stubProxy(requestStub, {drain: ownerlessDrain});

    const result = await TelemetryDrainDisplay.run([DRAIN_ID, '--target-org', testOrg.username]);
    expect(result.app).toBe('-');
    expect(result.ownerId).toBeUndefined();
    expect(result.ownerType).toBeUndefined();
  });

  it('labels App with the owner id when the owner app resolves but carries no name', async () => {
    // fetchComputeAppViaProxy returns undefined when the app has no name/region/generation, so the
    // `summary?.name ?? owner.id` fallback must still land on the owner id (not undefined/'-').
    stubProxy(requestStub, {drain: fullDrain, app: {}});

    const result = await TelemetryDrainDisplay.run([DRAIN_ID, '--target-org', testOrg.username]);

    expect(ownerCall(requestStub)).toBeDefined();
    expect(result.app).toBe(OWNER_APP_ID);
    expect(result.ownerId).toBe(OWNER_APP_ID);
    expect(result.ownerType).toBe('app');
  });

  it('falls back to the positional id for result.id when the drain carries no id', async () => {
    stubProxy(requestStub, {drain: {...fullDrain, id: undefined}, app: {name: OWNER_APP_NAME}});

    const result = await TelemetryDrainDisplay.run([DRAIN_ID, '--target-org', testOrg.username]);
    expect(result.id).toBe(DRAIN_ID);
  });

  it('returns the mapped {app,id,signals,endpoint,transport,headers} shape under --json, not the raw wire drain', async () => {
    stubProxy(requestStub, {drain: fullDrain, app: {name: OWNER_APP_NAME}});

    await TelemetryDrainDisplay.run([DRAIN_ID, '--target-org', testOrg.username, '--json']);

    const {result} = (sfCommandStubs.logJson.firstCall.args[0] as {result: Record<string, unknown>});
    expect(result).toEqual({
      app: OWNER_APP_NAME,
      ownerId: OWNER_APP_ID,
      ownerType: 'app',
      id: DRAIN_ID,
      signals: ['traces', 'logs'],
      endpoint: 'https://collector.example.com:4317',
      exporterType: 'otlp',
      transport: 'gRPC',
      // --json keeps headers verbatim (machine channel at the caller's trust boundary); only the
      // human table masks them. The raw wire objects (owner/exporter) are still never surfaced.
      headers: {'x-api-key': 'secret'},
    });
    expect('owner' in result).toBe(false);
    expect('exporter' in result).toBe(false);
    expect('created_at' in result).toBe(false);
  });

  it.each([
    ['otlp', 'gRPC'],
    ['otlphttp', 'HTTP'],
    ['splunk', 'HTTP'],
  ])('maps exporter type %s to the %s transport label', async (type, label) => {
    stubProxy(requestStub, {drain: {...fullDrain, exporter: {type, endpoint: 'https://x'}}, app: {name: OWNER_APP_NAME}});

    const result = await TelemetryDrainDisplay.run([DRAIN_ID, '--target-org', testOrg.username]);
    expect(result.transport).toBe(label);
    // The raw exporter type rides through so --json can tell otlphttp from splunk (both label "HTTP").
    expect(result.exporterType).toBe(type);
    const [{data}] = sfCommandStubs.table.firstCall.args as [{data: Array<{key: string; value: string}>}];
    expect(data.find(r => r.key === 'Transport')?.value).toBe(label);
  });

  it('renders a dash for Headers and leaves them undefined when the drain has none', async () => {
    stubProxy(requestStub, {
      drain: {...fullDrain, exporter: {type: 'splunk', endpoint: 'https://x'}},
      app: {name: OWNER_APP_NAME},
    });

    const result = await TelemetryDrainDisplay.run([DRAIN_ID, '--target-org', testOrg.username]);
    expect(result.headers).toBeUndefined();
    const [{data}] = sfCommandStubs.table.firstCall.args as [{data: Array<{key: string; value: string}>}];
    expect(data.find(r => r.key === 'Headers')?.value).toBe('-');
  });

  it('surfaces error.telemetryDrainNotFound when Heroku 404s the drain id', async () => {
    requestStub.mockRejectedValue(Object.assign(new Error("Couldn't find that."), {data: {id: 'not_found'}}));

    await expect(TelemetryDrainDisplay.run([DRAIN_ID, '--target-org', testOrg.username])).rejects.toThrow(
      `Heroku didn't find a telemetry drain with ID ${DRAIN_ID}.`,
    );
  });

  it('wraps a proxy-rejection failure as error.herokuProxyRequestFailed', async () => {
    requestStub.mockRejectedValue(Object.assign(new Error('bad proxy_url'), {errorCode: 'HEROKU_PROXY_ERROR'}));

    await expect(TelemetryDrainDisplay.run([DRAIN_ID, '--target-org', testOrg.username])).rejects.toThrow(
      'The Salesforce Heroku API proxy rejected the request: bad proxy_url',
    );
  });

  it('wraps an unrecognized failure as error.herokuApiRequestFailed', async () => {
    requestStub.mockRejectedValue(new Error('socket hang up'));

    await expect(TelemetryDrainDisplay.run([DRAIN_ID, '--target-org', testOrg.username])).rejects.toThrow(
      "Couldn't reach the Heroku Platform API through Salesforce: socket hang up",
    );
  });

  it('requires the drain-id positional arg, erroring without fetching a drain', async () => {
    await expect(TelemetryDrainDisplay.run(['--target-org', testOrg.username])).rejects.toThrow();

    const drainFetch = requestStub.mock.calls.find(c => {
      const req = c[0] as {url?: string};
      return req.url !== undefined && proxyTarget(req.url).includes('/telemetry-drains');
    });
    expect(drainFetch).toBeUndefined();
  });
});
