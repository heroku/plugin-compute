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

import {parseName, validateName} from '../../src/shared/computeApp.js';

describe('computeApp.parseName', () => {
  it('parses a bare DeveloperName with no namespace', () => {
    expect(parseName('CreditRatingScorer')).toEqual({developerName: 'CreditRatingScorer'});
  });

  it('splits a namespace-qualified name on its first "__"', () => {
    expect(parseName('myns__CreditRatingScorer')).toEqual({
      developerName: 'CreditRatingScorer',
      namespace: 'myns',
    });
  });

  it('treats everything after the first "__" as the DeveloperName, even if it contains more underscores', () => {
    expect(parseName('myns__Credit_Rating_Scorer')).toEqual({
      developerName: 'Credit_Rating_Scorer',
      namespace: 'myns',
    });
  });

  it('accepts a 15-character namespace (the maximum length)', () => {
    const namespace = 'a'.repeat(15);
    expect(parseName(`${namespace}__App`)).toEqual({developerName: 'App', namespace});
  });

  it('accepts a single-character namespace (the minimum length)', () => {
    expect(parseName('a__App')).toEqual({developerName: 'App', namespace: 'a'});
  });

  it('rejects a bare name starting with a digit', () => {
    expect(() => parseName('1App')).toThrow(/isn't valid/v);
  });

  it('rejects a namespace-qualified name whose developerName part has two consecutive underscores', () => {
    // The first "__" is always treated as the namespace separator, so a double underscore only
    // surfaces as invalid once it appears in the developerName part after that split.
    expect(() => parseName('myns__My__App')).toThrow(/isn't valid/v);
  });

  it('rejects a bare name ending in an underscore', () => {
    expect(() => parseName('MyApp_')).toThrow(/isn't valid/v);
  });

  it('rejects a bare name containing a hyphen', () => {
    expect(() => parseName('My-App')).toThrow(/isn't valid/v);
  });

  it('rejects a 16-character namespace (over the maximum length)', () => {
    const namespace = 'a'.repeat(16);
    expect(() => parseName(`${namespace}__App`)).toThrow(/isn't valid/v);
  });

  it('rejects a namespace starting with a digit', () => {
    expect(() => parseName('1ns__App')).toThrow(/isn't valid/v);
  });

  it('rejects a namespace containing two consecutive underscores', () => {
    expect(() => parseName('my__ns__App')).toThrow(/isn't valid/v);
  });

  it('rejects an empty developerName after the namespace separator', () => {
    expect(() => parseName('myns__')).toThrow(/isn't valid/v);
  });

  it('includes the original --name value in the error message', () => {
    expect(() => parseName('1App')).toThrow('1App');
  });
});

describe('computeApp.validateName', () => {
  it('does not throw for a valid bare DeveloperName', () => {
    expect(() => {
      validateName('CreditRatingScorer');
    }).not.toThrow();
  });

  it('does not throw for a valid namespace-qualified name', () => {
    expect(() => {
      validateName('myns__CreditRatingScorer');
    }).not.toThrow();
  });

  it('throws for an invalid name', () => {
    expect(() => {
      validateName('1App');
    }).toThrow(/isn't valid/v);
  });
});
