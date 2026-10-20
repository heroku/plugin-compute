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

import type {Mock} from 'vitest';

import {Org} from '@salesforce/core';
import {MockTestOrgData, TestContext} from '@salesforce/core/testSetup';
import {stubSfCommandUx} from '@salesforce/sf-plugins-core';

import TelemetryDrainUpdate from '../../../../src/commands/compute/update/telemetry-drain.js';

function proxyTarget(url: string): string {
  return new URL(url, 'https://example.com').searchParams.get('proxy_url') ?? '';
}

function findPatchCall(stub: Mock): undefined | {body: string; url: string} {
  const call = stub.mock.calls.find(c => {
    const req = c[0] as undefined | {method?: string; url?: string};
    return req?.method === 'PATCH' && req.url !== undefined && proxyTarget(req.url).includes('/telemetry-drains/');
  });
  return call?.[0] as undefined | {body: string; url: string};
}

const DRAIN_ID = '01234567-89ab-cdef-0123-456789abcdef';

describe('compute update telemetry-drain', () => {
  const $$ = new TestContext();
  const testOrg = new MockTestOrgData();
  let sfCommandStubs: ReturnType<typeof stubSfCommandUx>;
  let requestStub: Mock;

  beforeEach(async () => {
    sfCommandStubs = stubSfCommandUx($$.SANDBOX);
    await $$.stubAuths(testOrg);

    const org = await Org.create({aliasOrUsername: testOrg.username});
    const connection = org.getConnection();
    $$.SANDBOX.stub(Org.prototype, 'getConnection').returns(connection);

    requestStub = vi.fn().mockResolvedValue({
      id: DRAIN_ID,
      signals: ['logs'],
      exporter: {type: 'otlphttp', endpoint: 'https://new.example.com'},
    });
    $$.fakeConnectionRequest = requestStub;
  });

  afterEach(() => {
    process.exitCode = 0;
    $$.restore();
    vi.restoreAllMocks();
  });

  it('PATCHes only the endpoint when only --url is given', async () => {
    await TelemetryDrainUpdate.run([DRAIN_ID, '--url', 'https://new.example.com', '--target-org', testOrg.username]);

    const patch = findPatchCall(requestStub);
    expect(patch, 'expected a PATCH proxied to Heroku telemetry-drains/{id}').toBeDefined();
    expect(proxyTarget(patch!.url)).toBe(`https://api.heroku.com/telemetry-drains/${DRAIN_ID}`);
    expect(JSON.parse(patch!.body)).toEqual({exporter: {endpoint: 'https://new.example.com'}});
  });

  it('PATCHes only the signals when only --signals is given', async () => {
    await TelemetryDrainUpdate.run([DRAIN_ID, '--signals', 'logs', '--target-org', testOrg.username]);

    expect(JSON.parse(findPatchCall(requestStub)!.body)).toEqual({signals: ['logs']});
  });

  it('maps --transport and --header onto the exporter', async () => {
    await TelemetryDrainUpdate.run([
      DRAIN_ID,
      '--transport',
      'grpc',
      '--header',
      'x-api-key=secret',
      '--target-org',
      testOrg.username,
    ]);

    expect(JSON.parse(findPatchCall(requestStub)!.body)).toEqual({
      exporter: {type: 'otlp', headers: {'x-api-key': 'secret'}},
    });
  });

  it('errors without calling Heroku when no attribute to change is given', async () => {
    await expect(TelemetryDrainUpdate.run([DRAIN_ID, '--target-org', testOrg.username])).rejects.toThrow(
      /at least one/iv,
    );
    expect(findPatchCall(requestStub)).toBeUndefined();
  });

  it('rejects an invalid signal before calling Heroku', async () => {
    await expect(
      TelemetryDrainUpdate.run([DRAIN_ID, '--signals', 'bogus', '--target-org', testOrg.username]),
    ).rejects.toThrow(/bogus/v);
    expect(findPatchCall(requestStub)).toBeUndefined();
  });

  it('rejects an invalid transport before calling Heroku', async () => {
    await expect(
      TelemetryDrainUpdate.run([DRAIN_ID, '--transport', 'kafka', '--target-org', testOrg.username]),
    ).rejects.toThrow(/kafka/v);
    expect(findPatchCall(requestStub)).toBeUndefined();
  });

  it('accepts the hidden splunk transport', async () => {
    await TelemetryDrainUpdate.run([DRAIN_ID, '--transport', 'splunk', '--target-org', testOrg.username]);

    expect(JSON.parse(findPatchCall(requestStub)!.body)).toEqual({exporter: {type: 'splunk'}});
  });

  it('rejects a malformed header before calling Heroku', async () => {
    await expect(
      TelemetryDrainUpdate.run([DRAIN_ID, '--header', 'no-equals-sign', '--target-org', testOrg.username]),
    ).rejects.toThrow(/no-equals-sign/v);
    expect(findPatchCall(requestStub)).toBeUndefined();
  });

  it('requires the drain ID', async () => {
    await expect(TelemetryDrainUpdate.run(['--url', 'https://x.example.com', '--target-org', testOrg.username])).rejects.toThrow();
  });

  it('reports the updated drain and returns it for --json', async () => {
    const result = await TelemetryDrainUpdate.run([
      DRAIN_ID,
      '--url',
      'https://new.example.com',
      '--target-org',
      testOrg.username,
    ]);

    expect(sfCommandStubs.logSuccess.firstCall.args[0]).toContain(DRAIN_ID);
    expect(result).toEqual({
      id: DRAIN_ID,
      signals: ['logs'],
      endpoint: 'https://new.example.com',
      exporterType: 'otlphttp',
      transport: 'HTTP',
      headers: undefined,
    });
  });

  it('falls back to the requested drain ID when the response omits it', async () => {
    requestStub.mockResolvedValue({signals: ['logs'], exporter: {type: 'otlphttp', endpoint: 'https://new.example.com'}});

    const result = await TelemetryDrainUpdate.run([
      DRAIN_ID,
      '--url',
      'https://new.example.com',
      '--target-org',
      testOrg.username,
    ]);

    expect(result.id).toBe(DRAIN_ID);
    expect(sfCommandStubs.logSuccess.firstCall.args[0]).toContain(DRAIN_ID);
  });
});
