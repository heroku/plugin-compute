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

import {TestContext} from '@salesforce/core/testSetup';
import {stubSfCommandUx} from '@salesforce/sf-plugins-core';

import Deploy from '../../../src/commands/compute/deploy.js';

describe('compute deploy', () => {
  const $$ = new TestContext();

  afterEach(() => {
    $$.restore();
  });

  it('warns users to install plugin-deploy-retrieve and use project deploy start', async () => {
    const sfCommandStubs = stubSfCommandUx($$.SANDBOX);

    await Deploy.run([]);

    expect(sfCommandStubs.warn.calledOnce).toBe(true);
    expect(sfCommandStubs.warn.firstCall.args[0]).toContain('sf plugins install @salesforce/plugin-deploy-retrieve@compute');
    expect(sfCommandStubs.warn.firstCall.args[0]).toContain('project deploy start');
  });

  it('returns the migration message with --json', async () => {
    const sfCommandStubs = stubSfCommandUx($$.SANDBOX);

    await Deploy.run(['--json']);

    const output = sfCommandStubs.logJson.firstCall.args[0] as {result: {message: string}};
    expect(output.result.message).toContain('project deploy start');
    expect(output.result.message).toContain('@salesforce/plugin-deploy-retrieve@compute');
  });
});
