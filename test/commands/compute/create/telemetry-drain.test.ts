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

import type {Mock, MockInstance} from 'vitest';

import {Org} from '@salesforce/core';
import {MockTestOrgData, TestContext} from '@salesforce/core/testSetup';
import {stubSfCommandUx} from '@salesforce/sf-plugins-core';

import TelemetryDrainCreate from '../../../../src/commands/compute/create/telemetry-drain.js';

// Decode the real Heroku target URL out of the proxy_url query param -- mirrors herokuProxyRequest's
// proxyUrl construction (see list/telemetry-drain.test.ts).
function proxyTarget(url: string): string {
  return new URL(url, 'https://example.com').searchParams.get('proxy_url') ?? '';
}

function findPostCall(stub: Mock): undefined | {body: string; url: string} {
  const call = stub.mock.calls.find(c => {
    const req = c[0] as undefined | {method?: string; url?: string};
    return req?.method === 'POST' && req.url !== undefined && proxyTarget(req.url).endsWith('/telemetry-drains');
  });
  return call?.[0] as undefined | {body: string; url: string};
}

const APP_ID = 'a1b2c3d4-heroku-app-id';
const URL_FLAG = 'https://collector.example.com:4318';

const computeAppRecord = {
  CurrentBuild: null,
  Description: null,
  DeveloperName: 'CreditRatingScorer',
  ExternalAppIdentifier: APP_ID,
  ExternalServiceRegistration: null,
  Id: '0abEE0000004CqYYAU',
  MasterLabel: 'Credit Rating Scorer',
  Status: 'ACTIVE',
  StatusReason: null,
};

describe('compute create telemetry-drain', () => {
  const $$ = new TestContext();
  const testOrg = new MockTestOrgData();
  let sfCommandStubs: ReturnType<typeof stubSfCommandUx>;
  let toolingQueryStub: MockInstance;
  let requestStub: Mock;

  const baseArgs = () => ['--name', 'CreditRatingScorer', '--url', URL_FLAG, '--target-org', testOrg.username];

  beforeEach(async () => {
    sfCommandStubs = stubSfCommandUx($$.SANDBOX);
    await $$.stubAuths(testOrg);

    const org = await Org.create({aliasOrUsername: testOrg.username});
    const connection = org.getConnection();
    toolingQueryStub = vi.spyOn(connection.tooling, 'query');
    toolingQueryStub.mockResolvedValue({done: true, records: [computeAppRecord], totalSize: 1});
    $$.SANDBOX.stub(Org.prototype, 'getConnection').returns(connection);

    requestStub = vi.fn().mockResolvedValue({
      id: 'drain-new',
      signals: ['traces', 'metrics', 'logs'],
      exporter: {type: 'otlphttp', endpoint: URL_FLAG},
    });
    $$.fakeConnectionRequest = requestStub;
  });

  afterEach(() => {
    process.exitCode = 0;
    $$.restore();
    vi.restoreAllMocks();
  });

  it('creates an app-owned drain defaulting to all signals over http', async () => {
    const result = await TelemetryDrainCreate.run(baseArgs());

    const post = findPostCall(requestStub);
    expect(post, 'expected a POST proxied to Heroku telemetry-drains').toBeDefined();
    expect(proxyTarget(post!.url)).toBe('https://api.heroku.com/telemetry-drains');
    expect(JSON.parse(post!.body)).toEqual({
      owner: {id: APP_ID, type: 'app'},
      signals: ['traces', 'metrics', 'logs'],
      exporter: {type: 'otlphttp', endpoint: URL_FLAG},
    });
    expect(result).toMatchObject({app: 'CreditRatingScorer', id: 'drain-new', transport: 'HTTP'});
  });

  it('maps --signals and --transport grpc onto the request', async () => {
    await TelemetryDrainCreate.run([...baseArgs(), '--signals', 'traces,logs', '--transport', 'grpc']);

    expect(JSON.parse(findPostCall(requestStub)!.body)).toMatchObject({
      signals: ['traces', 'logs'],
      exporter: {type: 'otlp'},
    });
  });

  it('accepts the hidden splunk transport', async () => {
    await TelemetryDrainCreate.run([...baseArgs(), '--transport', 'splunk']);

    expect(JSON.parse(findPostCall(requestStub)!.body)).toMatchObject({exporter: {type: 'splunk'}});
  });

  it('sends repeated --header key=value flags as exporter headers', async () => {
    await TelemetryDrainCreate.run([...baseArgs(), '--header', 'x-api-key=secret', '--header', 'x-team=compute']);

    expect(JSON.parse(findPostCall(requestStub)!.body)).toMatchObject({
      exporter: {headers: {'x-api-key': 'secret', 'x-team': 'compute'}},
    });
  });

  it('reports the new drain ID and app on success', async () => {
    await TelemetryDrainCreate.run(baseArgs());

    expect(sfCommandStubs.logSuccess.firstCall.args[0]).toContain('drain-new');
    expect(sfCommandStubs.logSuccess.firstCall.args[0]).toContain('CreditRatingScorer');
  });

  it('redacts every header value in JSON without mutating the response', async () => {
    const drain = {
      id: 'drain-new',
      signals: ['logs'],
      exporter: {type: 'otlp', endpoint: URL_FLAG, headers: {k: 'v', empty: ''}},
    };
    requestStub.mockResolvedValue(drain);

    await TelemetryDrainCreate.run([...baseArgs(), '--json']);
    const {result} = sfCommandStubs.logJson.firstCall.args[0] as {result: unknown};

    expect(result).toEqual({
      app: 'CreditRatingScorer',
      id: 'drain-new',
      signals: ['logs'],
      endpoint: URL_FLAG,
      exporterType: 'otlp',
      transport: 'gRPC',
      headers: {k: '<redacted>', empty: '<redacted>'},
    });
    expect(drain.exporter.headers).toEqual({k: 'v', empty: ''});
  });

  it('rejects an invalid signal before calling Heroku', async () => {
    await expect(TelemetryDrainCreate.run([...baseArgs(), '--signals', 'bogus'])).rejects.toThrow(/bogus/v);
    expect(findPostCall(requestStub)).toBeUndefined();
  });

  it('rejects an invalid transport before calling Heroku', async () => {
    await expect(TelemetryDrainCreate.run([...baseArgs(), '--transport', 'carrier-pigeon'])).rejects.toThrow(
      /carrier-pigeon/v,
    );
    expect(findPostCall(requestStub)).toBeUndefined();
  });

  it('rejects a malformed --header before calling Heroku', async () => {
    await expect(TelemetryDrainCreate.run([...baseArgs(), '--header', 'no-equals'])).rejects.toThrow(/key=value/v);
    expect(findPostCall(requestStub)).toBeUndefined();
  });

  it.each([false, true])('does not expose malformed header credentials (json=%s)', async json => {
    const args = [...baseArgs(), '--header', 'Authorization=Bearer secret\n', ...(json ? ['--json'] : [])];
    const command = TelemetryDrainCreate.run(args);

    await expect(command).rejects.toThrow("A telemetry header isn't valid. Headers must be passed as key=value.");
    await expect(command).rejects.not.toThrow('secret');
    expect(sfCommandStubs.logJson.called).toBe(json);
    expect(JSON.stringify(sfCommandStubs.logJson.getCalls().map(call => call.args))).not.toContain('secret');

    expect(findPostCall(requestStub)).toBeUndefined();
  });

  it('requires --url', async () => {
    await expect(
      TelemetryDrainCreate.run(['--name', 'CreditRatingScorer', '--target-org', testOrg.username]),
    ).rejects.toThrow(/url/iv);
  });
});
