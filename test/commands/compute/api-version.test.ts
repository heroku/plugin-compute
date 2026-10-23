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

import {Org} from '@salesforce/core';
import {MockTestOrgData, TestContext} from '@salesforce/core/testSetup';
import {stubSfCommandUx} from '@salesforce/sf-plugins-core';

import Create from '../../../src/commands/compute/create/telemetry-drain.js';
import Delete from '../../../src/commands/compute/delete/telemetry-drain.js';
import Display from '../../../src/commands/compute/display.js';
import DisplayDrain from '../../../src/commands/compute/display/telemetry-drain.js';
import GetBuildLog from '../../../src/commands/compute/get/build-log.js';
import GetConfig from '../../../src/commands/compute/get/config.js';
import GetRuntimeLog from '../../../src/commands/compute/get/runtime-log.js';
import List from '../../../src/commands/compute/list.js';
import ListConfig from '../../../src/commands/compute/list/config.js';
import ListDrain from '../../../src/commands/compute/list/telemetry-drain.js';
import Scale from '../../../src/commands/compute/scale.js';
import SetConfig from '../../../src/commands/compute/set/config.js';
import Tail from '../../../src/commands/compute/tail/runtime-log.js';
import UnsetConfig from '../../../src/commands/compute/unset/config.js';
import Update from '../../../src/commands/compute/update/telemetry-drain.js';

describe('org API version forwarding', () => {
  const $$ = new TestContext();
  const testOrg = new MockTestOrgData();

  beforeEach(async () => {
    stubSfCommandUx($$.SANDBOX);
    await $$.stubAuths(testOrg);
  });

  afterEach(() => {
    process.exitCode = 0;
    $$.restore();
    vi.restoreAllMocks();
  });

  const commands: Array<[string, (args: string[]) => Promise<unknown>, string[]]> = [
    ['create telemetry-drain', async args => Create.run(args), ['--name', 'TestApp', '--url', 'https://collector.example.com']],
    ['delete telemetry-drain', async args => Delete.run(args), ['drain-id', '--no-prompt']],
    ['display', async args => Display.run(args), ['--name', 'TestApp']],
    ['display telemetry-drain', async args => DisplayDrain.run(args), ['drain-id']],
    ['get build-log', async args => GetBuildLog.run(args), ['--name', 'TestApp']],
    ['get config', async args => GetConfig.run(args), ['KEY', '--name', 'TestApp']],
    ['get runtime-log', async args => GetRuntimeLog.run(args), ['--name', 'TestApp']],
    ['list', async args => List.run(args), []],
    ['list config', async args => ListConfig.run(args), ['--name', 'TestApp']],
    ['list telemetry-drain', async args => ListDrain.run(args), ['--name', 'TestApp']],
    ['scale', async args => Scale.run(args), ['--name', 'TestApp', '--process-type', 'web', '--quantity', '1']],
    ['set config', async args => SetConfig.run(args), ['KEY=value', '--name', 'TestApp']],
    ['tail runtime-log', async args => Tail.run(args), ['--name', 'TestApp']],
    ['unset config', async args => UnsetConfig.run(args), ['KEY', '--name', 'TestApp']],
    ['update telemetry-drain', async args => Update.run(args), ['drain-id', '--signals', 'logs']],
  ];

  it.each(commands)('%s passes an explicit --api-version to getConnection', async (_name, run, args) => {
    const org = await Org.create({aliasOrUsername: testOrg.username});
    const connection = org.getConnection();
    const getConnection = vi.spyOn(Org.prototype, 'getConnection').mockImplementation(version => {
      if (version === '70.0') {
        throw new Error('API version reached connection');
      }

      return connection;
    });

    await expect(run([...args, '--target-org', testOrg.username, '--api-version', '70.0']))
      .rejects.toThrow('API version reached connection');
    expect(getConnection).toHaveBeenCalledWith('70.0');
  });
});
