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
import { expect } from 'chai';
import { requireConfigVar, formatConfigVarLines } from '../../src/shared/computeConfig.js';

describe('computeConfig.requireConfigVar', () => {
  it('returns the value when the key exists', () => {
    expect(requireConfigVar({ FOO: 'bar' }, 'CreditRatingScorer', 'FOO')).to.equal('bar');
  });

  it('throws error.configVarNotFound, naming the app and the missing key, when it does not', () => {
    try {
      requireConfigVar({ FOO: 'bar' }, 'CreditRatingScorer', 'MISSING');
      expect.fail('expected requireConfigVar to throw');
    } catch (err) {
      expect((err as Error).message).to.equal('CreditRatingScorer has no config var named "MISSING".');
    }
  });

  it('is case-sensitive about key existence', () => {
    try {
      requireConfigVar({ FOO_BAR: 'x' }, 'CreditRatingScorer', 'foo_bar');
      expect.fail('expected requireConfigVar to throw');
    } catch (err) {
      expect((err as Error).message).to.include('"foo_bar"');
    }
  });
});

describe('computeConfig.formatConfigVarLines', () => {
  it('right-pads keys to the widest key plus a two-space gap, in the map insertion order', () => {
    const lines = formatConfigVarLines({
      DATABASE_URL: 'postgres://user:pass@host:5432/db',
      LOG_LEVEL: 'info',
      STRIPE_KEY: 'sk_live_abc123',
    });

    expect(lines).to.deep.equal([
      'DATABASE_URL:  postgres://user:pass@host:5432/db',
      'LOG_LEVEL:     info',
      'STRIPE_KEY:    sk_live_abc123',
    ]);
  });

  it('returns one line per key with a single key', () => {
    expect(formatConfigVarLines({ FOO: 'bar' })).to.deep.equal(['FOO:  bar']);
  });

  it('returns an empty array for an empty map', () => {
    expect(formatConfigVarLines({})).to.deep.equal([]);
  });
});
