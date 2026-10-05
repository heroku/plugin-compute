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
import {downloadComputeSource, uploadComputeSource} from '../../src/shared/computeConnectApi.js';

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

describe('computeConnectApi.downloadComputeSource', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('GETs /connect/compute/{app_id_or_name}/source with { encoding: binary } and returns the exact original bytes', async () => {
    // Bytes >0x7F are where UTF-8 decoding would corrupt a binary gzip payload -- this is a
    // real byte-content round-trip assertion, not just a "was called" assertion.
    const original = Buffer.from([0x1F, 0x8B, 0x00, 0xFF, 0x80, 0x41, 0x00, 0xDE, 0xAD, 0xBE, 0xEF]);
    const request = vi.fn().mockResolvedValue(original.toString('binary'));
    const connection = {request} as unknown as Connection;

    const result = await downloadComputeSource(connection, {appIdOrName: 'CreditRatingScorer'});

    expect(Buffer.compare(result, original)).toBe(0);
    expect(request).toHaveBeenCalledOnce();
    const [httpRequest, options] = request.mock.calls[0] as [{method: string; url: string}, {encoding: string}];
    expect(httpRequest.method).toBe('GET');
    expect(httpRequest.url).toBe('/connect/compute/CreditRatingScorer/source');
    expect(options).toEqual({encoding: 'binary'});
  });

  it('URL-encodes the app_id_or_name path segment', async () => {
    const request = vi.fn().mockResolvedValue('');
    const connection = {request} as unknown as Connection;

    await downloadComputeSource(connection, {appIdOrName: 'my app/1'});

    const [httpRequest] = request.mock.calls[0] as [{url: string}];
    expect(httpRequest.url).toBe('/connect/compute/my%20app%2F1/source');
  });

  it('translates a failed request into a createError-style message', async () => {
    const request = vi.fn().mockRejectedValue(new Error('socket hang up'));
    const connection = {request} as unknown as Connection;

    let error: Error | undefined;
    try {
      await downloadComputeSource(connection, {appIdOrName: 'CreditRatingScorer'});
    } catch (error_) {
      error = error_ as Error;
    }

    expect(error).toBeDefined();
    expect(error?.message).toContain('socket hang up');
    expect(error?.message).toContain('source');
  });
});
