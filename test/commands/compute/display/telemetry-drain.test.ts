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
// The Heroku app id carried in the drain's owner.id -- hyphenated, so --name/NAME_PATTERN rejects it.
const OWNER_APP_ID = 'a1b2c3d4-heroku-app-id';
// The owning compute app's Salesforce DeveloperName, as the org reverse-lookup returns it. Name-shaped
// (--name-valid) and visibly different from OWNER_APP_ID, so a passing App assertion proves the command
// surfaces the --name-usable identity rather than echoing the Heroku id.
const OWNER_DEV_NAME = 'CreditRatingScorer';

type Drain = {
  exporter?: {endpoint?: string; headers?: Record<string, string>; type?: string};
  id?: string;
  owner?: {id?: string; type?: string};
  signals?: string[];
};

// Only the drain fetch rides the Heroku proxy now; the App label is resolved org-side (see
// connection.tooling.query stub below), so the proxy stub just returns the drain for its path.
function stubDrain(requestStub: Mock, drain: Drain): void {
  requestStub.mockImplementation(async (req: {url?: string}) => {
    const target = proxyTarget(req.url ?? '');
    if (target.includes('/telemetry-drains/')) {
      return drain;
    }

    return {};
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
    // For an app-owned drain the command maps owner.id -> compute app DeveloperName through the org;
    // findDeveloperNameByHerokuAppId's singleRecordQuery bottoms out here. Default to a single match;
    // individual tests override for the no-match / multi-match / query-error fallbacks.
    toolingQueryStub = vi.spyOn(connection.tooling, 'query');
    toolingQueryStub.mockResolvedValue({done: true, records: [{DeveloperName: OWNER_DEV_NAME}], totalSize: 1});
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
    stubDrain(requestStub, fullDrain);

    await TelemetryDrainDisplay.run([DRAIN_ID, '--target-org', testOrg.username]);

    expect(sfCommandStubs.styledHeader.calledWith('Telemetry Drain')).toBe(true);
    const [{columns, data}] = sfCommandStubs.table.firstCall.args as [
      {columns: string[]; data: Array<{key: string; value: string}>},
    ];
    expect(columns).toEqual(['key', 'value']);
    expect(data).toEqual([
      {key: 'App', value: OWNER_DEV_NAME},
      {key: 'Signals', value: 'traces, logs'},
      {key: 'Endpoint', value: 'https://collector.example.com:4317'},
      {key: 'Transport', value: 'gRPC'},
      // The table masks header VALUES (keys stay) so a secret can't leak into scrollback/screenshots.
      {key: 'Headers', value: '{"x-api-key":"<redacted>"}'},
    ]);
    expect(toolingQueryStub).toHaveBeenCalled();
  });

  it('GETs the single-drain path, url-encoding the drain id', async () => {
    stubDrain(requestStub, fullDrain);

    await TelemetryDrainDisplay.run(['a/b c', '--target-org', testOrg.username]);

    const call = requestStub.mock.calls.find(c => {
      const req = c[0] as {url?: string};
      return req.url !== undefined && proxyTarget(req.url).includes('/telemetry-drains/');
    });
    expect(call).toBeDefined();
    expect(proxyTarget((call![0] as {url: string}).url)).toBe('https://api.heroku.com/telemetry-drains/a%2Fb%20c');
  });

  it('labels App with the compute app name resolved from the drain owner via the org (not the positional id)', async () => {
    stubDrain(requestStub, fullDrain);

    const result = await TelemetryDrainDisplay.run([DRAIN_ID, '--target-org', testOrg.username]);

    // The reverse lookup filters on the drain's own owner id, not the positional drain id.
    const [soql] = toolingQueryStub.mock.calls[0] as [string];
    expect(soql).toContain(`WHERE ExternalAppIdentifier = '${OWNER_APP_ID}'`);
    expect(result.app).toBe(OWNER_DEV_NAME);
    expect(result.app).not.toBe(DRAIN_ID);
    expect(result.app).not.toBe(OWNER_APP_ID);
    // The raw owner rides through flat so --json can disambiguate what the `app` label collapses.
    expect(result.ownerId).toBe(OWNER_APP_ID);
    expect(result.ownerType).toBe('app');
  });

  it('is best-effort: when no compute app matches the owner id it still succeeds, labelling App with the qualified Heroku id and not warning', async () => {
    stubDrain(requestStub, fullDrain);
    toolingQueryStub.mockResolvedValue({done: true, records: [], totalSize: 0});

    const result = await TelemetryDrainDisplay.run([DRAIN_ID, '--target-org', testOrg.username]);

    // --json keeps the raw owner id; the human table qualifies it so it can't be mistaken for --name.
    expect(result.app).toBe(OWNER_APP_ID);
    expect(result.ownerId).toBe(OWNER_APP_ID);
    expect(result.ownerType).toBe('app');
    // A failed label is non-fatal -- debug-logged, never warned.
    expect(sfCommandStubs.warn.called).toBe(false);
    const [{data}] = sfCommandStubs.table.firstCall.args as [{data: Array<{key: string; value: string}>}];
    expect(data.find(r => r.key === 'App')?.value).toBe(`${OWNER_APP_ID} (Heroku app id)`);
    expect(data.find(r => r.key === 'Signals')?.value).toBe('traces, logs');
  });

  it('is best-effort: when the org query itself fails it still renders the drain, labelling App with the qualified Heroku id and not warning', async () => {
    stubDrain(requestStub, fullDrain);
    toolingQueryStub.mockRejectedValue(new Error('INVALID_SESSION_ID'));

    const result = await TelemetryDrainDisplay.run([DRAIN_ID, '--target-org', testOrg.username]);

    expect(result.app).toBe(OWNER_APP_ID);
    expect(sfCommandStubs.warn.called).toBe(false);
    const [{data}] = sfCommandStubs.table.firstCall.args as [{data: Array<{key: string; value: string}>}];
    expect(data.find(r => r.key === 'App')?.value).toBe(`${OWNER_APP_ID} (Heroku app id)`);
  });

  it('never guesses when more than one compute app matches the owner id -- falls back to the qualified Heroku id', async () => {
    stubDrain(requestStub, fullDrain);
    toolingQueryStub.mockResolvedValue({
      done: true,
      records: [{DeveloperName: 'FirstMatch'}, {DeveloperName: 'SecondMatch'}],
      totalSize: 2,
    });

    const result = await TelemetryDrainDisplay.run([DRAIN_ID, '--target-org', testOrg.username]);

    expect(result.app).toBe(OWNER_APP_ID);
    expect(sfCommandStubs.warn.called).toBe(false);
    const [{data}] = sfCommandStubs.table.firstCall.args as [{data: Array<{key: string; value: string}>}];
    expect(data.find(r => r.key === 'App')?.value).toBe(`${OWNER_APP_ID} (Heroku app id)`);
  });

  it('does not resolve an app and labels App with the owner id for a space-owned drain', async () => {
    const spaceDrain: Drain = {...fullDrain, owner: {id: 'space-uuid', type: 'space'}};
    stubDrain(requestStub, spaceDrain);

    const result = await TelemetryDrainDisplay.run([DRAIN_ID, '--target-org', testOrg.username]);

    expect(result.app).toBe('space-uuid');
    expect(result.ownerId).toBe('space-uuid');
    expect(result.ownerType).toBe('space');
    // A space-owned drain has no owning compute app to resolve, so the org is never queried.
    expect(toolingQueryStub).not.toHaveBeenCalled();
  });

  it('falls back to a dash label when the drain has no owner', async () => {
    const ownerlessDrain: Drain = {...fullDrain, owner: undefined};
    stubDrain(requestStub, ownerlessDrain);

    const result = await TelemetryDrainDisplay.run([DRAIN_ID, '--target-org', testOrg.username]);
    expect(result.app).toBe('-');
    expect(result.ownerId).toBeUndefined();
    expect(result.ownerType).toBeUndefined();
    expect(toolingQueryStub).not.toHaveBeenCalled();
  });

  it('falls back to the positional id for result.id when the drain carries no id', async () => {
    stubDrain(requestStub, {...fullDrain, id: undefined});

    const result = await TelemetryDrainDisplay.run([DRAIN_ID, '--target-org', testOrg.username]);
    expect(result.id).toBe(DRAIN_ID);
  });

  it('returns the mapped {app,id,signals,endpoint,transport,headers} shape under --json, not the raw wire drain', async () => {
    stubDrain(requestStub, fullDrain);

    await TelemetryDrainDisplay.run([DRAIN_ID, '--target-org', testOrg.username, '--json']);

    const {result} = (sfCommandStubs.logJson.firstCall.args[0] as {result: Record<string, unknown>});
    expect(result).toEqual({
      app: OWNER_DEV_NAME,
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
    stubDrain(requestStub, {...fullDrain, exporter: {type, endpoint: 'https://x'}});

    const result = await TelemetryDrainDisplay.run([DRAIN_ID, '--target-org', testOrg.username]);
    expect(result.transport).toBe(label);
    // The raw exporter type rides through so --json can tell otlphttp from splunk (both label "HTTP").
    expect(result.exporterType).toBe(type);
    const [{data}] = sfCommandStubs.table.firstCall.args as [{data: Array<{key: string; value: string}>}];
    expect(data.find(r => r.key === 'Transport')?.value).toBe(label);
  });

  it('renders a dash for Headers and leaves them undefined when the drain has none', async () => {
    stubDrain(requestStub, {...fullDrain, exporter: {type: 'splunk', endpoint: 'https://x'}});

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
