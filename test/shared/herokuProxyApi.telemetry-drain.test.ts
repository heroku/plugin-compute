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

import {type Connection, Org} from '@salesforce/core';
import {MockTestOrgData, TestContext} from '@salesforce/core/testSetup';

import {
  createTelemetryDrainViaProxy,
  deleteTelemetryDrainViaProxy,
  fetchTelemetryDrainViaProxy,
  listTelemetryDrainsViaProxy,
  updateTelemetryDrainViaProxy,
} from '../../src/shared/herokuProxyApi.js';

const SDK_ACCEPT = 'application/vnd.heroku+json; version=3.sdk';
const APP_ID = 'a1b2c3d4-heroku-app-id';
const DRAIN_ID = '01234567-89ab-cdef-0123-456789abcdef';
const APP_NAME = 'CreditRatingScorer';

type HerokuRequest = {body?: string; headers?: Record<string, string>; method?: string; url?: string};

// Decode the real Heroku target URL out of the proxy_url query param -- mirrors herokuProxyRequest's
// proxyUrl construction. Asserting the inner target (not the outer /services/data/vXX path) keeps the
// assertions decoupled from resolveComputeApiVersion's version floor.
function proxyTarget(url: string): string {
  return new URL(url, 'https://example.com').searchParams.get('proxy_url') ?? '';
}

function telemetryCall(stub: Mock, method: string): HerokuRequest {
  const call = stub.mock.calls.find(c => {
    const req = c[0] as HerokuRequest | undefined;
    return req?.url !== undefined && proxyTarget(req.url).includes('/telemetry-drains') && req.method === method;
  });
  expect(call, `expected a ${method} proxied to a telemetry-drains path`).toBeDefined();
  return call![0] as HerokuRequest;
}

describe('herokuProxyApi telemetry drains', () => {
  const $$ = new TestContext();
  const testOrg = new MockTestOrgData();
  let connection: Connection;
  let requestStub: Mock;

  beforeEach(async () => {
    await $$.stubAuths(testOrg);
    const org = await Org.create({aliasOrUsername: testOrg.username});
    connection = org.getConnection();
    requestStub = vi.fn().mockResolvedValue({});
    $$.fakeConnectionRequest = requestStub;
  });

  afterEach(() => {
    $$.restore();
    vi.restoreAllMocks();
  });

  describe('listTelemetryDrainsViaProxy', () => {
    it('GETs the app telemetry-drains path with the 3.sdk Accept header and returns the array', async () => {
      const drains = [{id: DRAIN_ID, signals: ['traces']}];
      requestStub.mockResolvedValue(drains);

      const result = await listTelemetryDrainsViaProxy(connection, {appId: APP_ID, name: APP_NAME});

      expect(result).toEqual(drains);
      const req = telemetryCall(requestStub, 'GET');
      expect(proxyTarget(req.url!)).toBe(`https://api.heroku.com/apps/${APP_ID}/telemetry-drains`);
      expect(req.headers?.Accept).toBe(SDK_ACCEPT);
      expect(req.body).toBeUndefined();
    });

    it('returns an empty array when the app has no drains', async () => {
      requestStub.mockResolvedValue([]);
      await expect(listTelemetryDrainsViaProxy(connection, {appId: APP_ID, name: APP_NAME})).resolves.toEqual([]);
    });
  });

  describe('fetchTelemetryDrainViaProxy', () => {
    it('GETs the single-drain path, url-encoding the drain id', async () => {
      const drain = {id: DRAIN_ID, signals: ['logs']};
      requestStub.mockResolvedValue(drain);

      const result = await fetchTelemetryDrainViaProxy(connection, {drainId: 'a/b c'});

      expect(result).toEqual(drain);
      const req = telemetryCall(requestStub, 'GET');
      expect(proxyTarget(req.url!)).toBe('https://api.heroku.com/telemetry-drains/a%2Fb%20c');
      expect(req.headers?.Accept).toBe(SDK_ACCEPT);
    });
  });

  describe('createTelemetryDrainViaProxy', () => {
    it('POSTs an app-owned drain body built from the given fields', async () => {
      requestStub.mockResolvedValue({id: DRAIN_ID});

      await createTelemetryDrainViaProxy(connection, {
        appId: APP_ID,
        name: APP_NAME,
        endpoint: 'https://collector.example.com:4317',
        exporterType: 'otlp',
        signals: ['traces', 'metrics'],
        headers: {'x-api-key': 'secret'},
      });

      const req = telemetryCall(requestStub, 'POST');
      expect(proxyTarget(req.url!)).toBe('https://api.heroku.com/telemetry-drains');
      expect(req.headers?.Accept).toBe(SDK_ACCEPT);
      expect(JSON.parse(req.body!)).toEqual({
        owner: {id: APP_ID, type: 'app'},
        signals: ['traces', 'metrics'],
        exporter: {type: 'otlp', endpoint: 'https://collector.example.com:4317', headers: {'x-api-key': 'secret'}},
      });
    });

    it('omits exporter headers from the body when none are given', async () => {
      requestStub.mockResolvedValue({id: DRAIN_ID});

      await createTelemetryDrainViaProxy(connection, {
        appId: APP_ID,
        name: APP_NAME,
        endpoint: 'https://x',
        exporterType: 'splunk',
        signals: ['logs'],
      });

      const body = JSON.parse(telemetryCall(requestStub, 'POST').body!) as {exporter: Record<string, unknown>};
      expect(body.exporter).toEqual({type: 'splunk', endpoint: 'https://x'});
      expect('headers' in body.exporter).toBe(false);
    });
  });

  describe('updateTelemetryDrainViaProxy', () => {
    it('PATCHes the single-drain path with only the provided fields', async () => {
      requestStub.mockResolvedValue({id: DRAIN_ID});

      await updateTelemetryDrainViaProxy(connection, {
        drainId: DRAIN_ID,
        signals: ['metrics'],
      });

      const req = telemetryCall(requestStub, 'PATCH');
      expect(proxyTarget(req.url!)).toBe(`https://api.heroku.com/telemetry-drains/${DRAIN_ID}`);
      expect(req.headers?.Accept).toBe(SDK_ACCEPT);
      expect(JSON.parse(req.body!)).toEqual({signals: ['metrics']});
    });
  });

  describe('deleteTelemetryDrainViaProxy', () => {
    it('DELETEs the single-drain path and returns the deleted drain', async () => {
      const deleted = {id: DRAIN_ID, signals: ['traces']};
      requestStub.mockResolvedValue(deleted);

      const result = await deleteTelemetryDrainViaProxy(connection, {drainId: DRAIN_ID});

      expect(result).toEqual(deleted);
      const req = telemetryCall(requestStub, 'DELETE');
      expect(proxyTarget(req.url!)).toBe(`https://api.heroku.com/telemetry-drains/${DRAIN_ID}`);
      expect(req.headers?.Accept).toBe(SDK_ACCEPT);
    });
  });

  // Error classification is shared via throwHerokuProxyComputeError; the proxy/unknown branches are
  // exercised once through fetch. not_found is split: app-scoped calls name the app, drain-id calls
  // name the drain (via the error.telemetryDrainNotFound override).
  describe('error classification', () => {
    it('maps a not_found on an app-scoped call to error.herokuAppNotFound, naming the app', async () => {
      requestStub.mockRejectedValue(Object.assign(new Error("Couldn't find that."), {data: {id: 'not_found'}}));
      await expect(listTelemetryDrainsViaProxy(connection, {appId: APP_ID, name: APP_NAME})).rejects.toThrow(
        `Heroku didn't find an app named ${APP_NAME}.`,
      );
    });

    it('maps a not_found on a drain-id call to error.telemetryDrainNotFound, naming the drain', async () => {
      requestStub.mockRejectedValue(Object.assign(new Error("Couldn't find that."), {data: {id: 'not_found'}}));
      await expect(fetchTelemetryDrainViaProxy(connection, {drainId: DRAIN_ID})).rejects.toThrow(
        `Heroku didn't find a telemetry drain with ID ${DRAIN_ID}.`,
      );
    });

    it('maps a HEROKU_PROXY_ERROR to error.herokuProxyRequestFailed', async () => {
      requestStub.mockRejectedValue(Object.assign(new Error('bad proxy_url'), {errorCode: 'HEROKU_PROXY_ERROR'}));
      await expect(fetchTelemetryDrainViaProxy(connection, {drainId: DRAIN_ID})).rejects.toThrow(
        'The Salesforce Heroku API proxy rejected the request: bad proxy_url',
      );
    });

    // A Heroku 422 surfaces as a passthrough error carrying Heroku's own id ('invalid_params') and
    // message -- it must read as a rejection of what we sent, not as the connectivity-flavored
    // herokuApiRequestFailed (which the id-less socket case below still gets).
    it('maps a Heroku validation error (id set) to error.herokuRequestRejected, surfacing the message', async () => {
      requestStub.mockRejectedValue(
        Object.assign(new Error('endpoint is not a valid URL'), {data: {id: 'invalid_params'}}),
      );
      await expect(
        createTelemetryDrainViaProxy(connection, {
          appId: APP_ID,
          name: APP_NAME,
          endpoint: 'not-a-url',
          exporterType: 'otlp',
          signals: ['traces'],
        }),
      ).rejects.toThrow('Heroku rejected the request: endpoint is not a valid URL');
    });

    it('maps an unrecognized failure to error.herokuApiRequestFailed', async () => {
      requestStub.mockRejectedValue(new Error('socket hang up'));
      await expect(fetchTelemetryDrainViaProxy(connection, {drainId: DRAIN_ID})).rejects.toThrow(
        "Couldn't reach the Heroku Platform API through Salesforce: socket hang up",
      );
    });
  });
});
