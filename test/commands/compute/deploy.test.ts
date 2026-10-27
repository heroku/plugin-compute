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
    process.exitCode = 0;
    $$.restore();
  });

  it.each([
    {args: []},
    {args: ['--target-org', 'missing-org']},
    {args: ['--source-dir', '/does/not/exist']},
    {args: ['-o', 'missing-org', '-d', '/does/not/exist']},
  ])('rejects legacy arguments with migration guidance', async ({args}) => {
    const sfCommandStubs = stubSfCommandUx($$.SANDBOX);

    await expect(Deploy.run(args)).rejects.toThrow('This command no longer deploys compute apps.');

    expect(sfCommandStubs.logToStderr.calledOnce).toBe(true);
    expect(sfCommandStubs.logToStderr.firstCall.args[0]).toContain('sf plugins install @salesforce/plugin-deploy-retrieve@compute');
    expect(sfCommandStubs.logToStderr.firstCall.args[0]).toContain('ComputeApp:<app-name>');
  });

  it('returns a nonzero migration error with --json', async () => {
    const sfCommandStubs = stubSfCommandUx($$.SANDBOX);

    await expect(Deploy.run(['--json', '--target-org=missing-org', '--source-dir=/does/not/exist'])).rejects.toThrow(
      'This command no longer deploys compute apps.',
    );

    const output = sfCommandStubs.logJson.firstCall.args[0] as {message: string; result?: unknown; status: number};
    expect(output.status).toBe(1);
    expect(output.message).toContain('This command no longer deploys compute apps.');
    expect(output.result).toBeUndefined();
  });
});
