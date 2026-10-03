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

import {formatConfigVarLines, requireConfigVar} from '../../src/shared/computeConfig.js';

describe('computeConfig.requireConfigVar', () => {
  it('returns the value when the key exists', () => {
    expect(requireConfigVar({FOO: 'bar'}, 'CreditRatingScorer', 'FOO')).toBe('bar');
  });

  it('throws error.configVarNotFound, naming the app and the missing key, when it does not', () => {
    // Capture-then-assert (rather than expect(...).toThrow()) so the message check is exact
    // equality, preserving the original chai `.to.equal` fidelity on the full message --
    // toThrow(string) only substring-matches, and toThrow(new Error(...)) also compares the
    // error class, which here is ConfigVarNotFoundError, not Error.
    let error: Error | undefined;
    try {
      requireConfigVar({FOO: 'bar'}, 'CreditRatingScorer', 'MISSING');
    } catch (error_) {
      error = error_ as Error;
    }

    expect(error?.message).toBe('CreditRatingScorer has no config var named "MISSING".');
  });

  it('is case-sensitive about key existence', () => {
    expect(() => requireConfigVar({FOO_BAR: 'x'}, 'CreditRatingScorer', 'foo_bar')).toThrow('"foo_bar"');
  });
});

describe('computeConfig.formatConfigVarLines', () => {
  it('right-pads keys to the widest key plus a two-space gap, in the map insertion order', () => {
    const lines = formatConfigVarLines({
      DATABASE_URL: 'postgres://user:pass@host:5432/db',
      LOG_LEVEL: 'info',
      STRIPE_KEY: 'sk_live_abc123',
    });

    expect(lines).toEqual([
      'DATABASE_URL:  postgres://user:pass@host:5432/db',
      'LOG_LEVEL:     info',
      'STRIPE_KEY:    sk_live_abc123',
    ]);
  });

  it('returns one line per key with a single key', () => {
    expect(formatConfigVarLines({FOO: 'bar'})).toEqual(['FOO:  bar']);
  });

  it('returns an empty array for an empty map', () => {
    expect(formatConfigVarLines({})).toEqual([]);
  });
});
