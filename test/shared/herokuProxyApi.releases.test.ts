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

import {fetchLatestReleaseVersionViaProxy} from '../../src/shared/herokuProxyApi.js';

const APP_ID = 'a1b2c3d4-heroku-app-id';
const APP_NAME = 'CreditRatingScorer';

type HerokuRequest = {headers?: Record<string, string>; method?: string; url?: string};

describe('herokuProxyApi fetchLatestReleaseVersionViaProxy', () => {
  const $$ = new TestContext();
  const testOrg = new MockTestOrgData();
  let connection: Connection;
  let requestStub: Mock;

  beforeEach(async () => {
    await $$.stubAuths(testOrg);
    const org = await Org.create({aliasOrUsername: testOrg.username});
    connection = org.getConnection();
    requestStub = vi.fn().mockResolvedValue([{version: 37}]);
    $$.fakeConnectionRequest = requestStub;
  });

  afterEach(() => {
    $$.restore();
    vi.restoreAllMocks();
  });

  it('returns the highest release version', async () => {
    requestStub.mockResolvedValue([{version: 36}, {version: 37}]);
    await expect(fetchLatestReleaseVersionViaProxy(connection, {appId: APP_ID, name: APP_NAME})).resolves.toBe(37);
  });

  it('returns undefined for an app with no releases', async () => {
    requestStub.mockResolvedValue([]);
    await expect(fetchLatestReleaseVersionViaProxy(connection, {appId: APP_ID, name: APP_NAME})).resolves.toBeUndefined();
  });

  // Heroku's range_parser rejects a Range header with more than one ';' ("Invalid `Range` header"):
  // the range bounds and the options are separated by a single ';', and options by commas.
  it('sends a Range header in the form Heroku accepts: one ";", options comma-separated', async () => {
    await fetchLatestReleaseVersionViaProxy(connection, {appId: APP_ID, name: APP_NAME});

    const req = requestStub.mock.calls[0][0] as HerokuRequest;
    expect(req.headers?.Range).toBe('version ..; max=1, order=desc');
    expect(req.headers?.Range?.split(';')).toHaveLength(2);
  });
});
