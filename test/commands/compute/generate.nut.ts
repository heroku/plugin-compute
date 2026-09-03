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

import { execCmd, TestSession } from '@salesforce/cli-plugins-testkit';
import { expect } from 'chai';
import { ComputeGenerateResult } from '../../../src/commands/compute/generate.js';

let testSession: TestSession;

describe('compute generate NUTs', () => {
  before('prepare session', async () => {
    testSession = await TestSession.create({ project: { name: 'ComputeGenerateProject' } });
  });

  after(async () => {
    await testSession?.clean();
  });

  it('scaffolds a node compute app', () => {
    const result = execCmd<ComputeGenerateResult>('compute generate --name CreditRatingScorer --json', {
      ensureExitCode: 0,
    }).jsonOutput?.result;
    expect(result?.name).to.equal('CreditRatingScorer');
    expect(result?.language).to.equal('node');
  });

  it('fails when the app already exists', () => {
    const output = execCmd('compute generate --name CreditRatingScorer --json', { ensureExitCode: 1 }).jsonOutput;
    expect(output?.message).to.include('already exists');
  });
});
