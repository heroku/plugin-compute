import type {Connection} from '@salesforce/core';

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
import {uploadComputeSource} from '../../src/shared/computeConnectApi.js';

describe('computeConnectApi.uploadComputeSource', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('POSTs a multipart form to /connect/compute/source', async () => {
    const expected = {
      buildId: '0acEE0000004D1ZYAU',
      platformComputeId: '0abEE0000004CqYYAU',
      sourceBlobSize: 12,
      uploadedAt: '2026-08-31T00:00:00.000Z',
    };
    const request = vi.fn().mockResolvedValue(expected);
    const connection = {request} as unknown as Connection;

    const result = await uploadComputeSource(connection, {
      bundle: Buffer.from('fake-tarball-contents'),
      name: 'CreditRatingScorer',
    });

    expect(result).toEqual(expected);
    expect(request).toHaveBeenCalledOnce();
    const [httpRequest] = request.mock.calls[0] as [{headers: Record<string, string>; method: string; url: string}];
    expect(httpRequest.method).toBe('POST');
    expect(httpRequest.url).toBe('/connect/compute/source');
    expect(httpRequest.headers['content-type']).toContain('multipart/form-data');
  });

  it('translates a failed request into a createError-style message', async () => {
    const request = vi.fn().mockRejectedValue(new Error('socket hang up'));
    const connection = {request} as unknown as Connection;

    let error: Error | undefined;
    try {
      await uploadComputeSource(connection, {bundle: Buffer.from('x'), name: 'CreditRatingScorer'});
    } catch (error_) {
      error = error_ as Error;
    }

    expect(error).toBeDefined();
    expect(error?.message).toContain('socket hang up');
    expect(error?.message).toContain('Connect API');
  });
});
