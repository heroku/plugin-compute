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

import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import tarStream from 'tar-stream';
import { getLogger } from '@oclif/core';
import { Messages } from '@salesforce/core';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@salesforce/plugin-compute', 'compute.errors');

// Gated by DEBUG=sf:compute:generateSource (or DEBUG=*).
const debug = getLogger('sf:compute:generateSource').debug;

export type Language = 'node' | 'python';

// Pinned by commit SHA (immutable, unlike a branch/tag that can move or be deleted upstream)
// plus a SHA256 of the exact tarball codeload returns for that SHA -- the only integrity check
// on this third-party fetch, since the bytes get written directly into the customer's project.
// Bump both together when moving to a newer upstream commit; get the new checksum with:
//   curl -sL https://codeload.github.com/<repo>/tar.gz/<sha> | sha256sum
export const REFERENCE_APPS: Record<Language, { repo: string; sha: string; sha256: string }> = {
  node: {
    repo: 'heroku-reference-apps/applink-getting-started-nodejs',
    sha: '173aa4a95d1ef412d46c1f27b808103545ac2d7f',
    sha256: '6ca50f2e1345e6c92896617bbda7eec65faa1b126c0b0837696a9e3c0546a877',
  },
  python: {
    repo: 'heroku-reference-apps/applink-getting-started-python',
    sha: '8db54051187f74f341e200a2876a5c47dc1c98c1',
    sha256: '7f6bb119b07dc274b8f2e151e31cca8ba890d8387c5f812b377b3f0b8823d1db',
  },
};

export type FetchTemplateSource = (language: Language) => Promise<Record<string, Buffer>>;

// Fetches the pinned commit's tarball over HTTPS (GitHub codeload -- no git CLI, no auth, no
// git metadata), verifies it against the hardcoded checksum above, then extracts every file
// entry into memory keyed by its path with the tarball's own "<repo>-<sha>/" prefix stripped.
// Callers decide per-path which entries to keep verbatim, transform, or discard in favor of a
// locally authored skeleton file -- see buildStarterFiles in commands/compute/generate.ts.
export const fetchTemplateSource: FetchTemplateSource = async (language) => {
  const { repo, sha, sha256 } = REFERENCE_APPS[language];
  const url = `https://codeload.github.com/${repo}/tar.gz/${sha}`;

  let buffer: Buffer;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    buffer = Buffer.from(await response.arrayBuffer());
  } catch (err) {
    throw messages.createError('error.templateSourceFetchFailed', [language, (err as Error).message]);
  }

  const actualSha256 = createHash('sha256').update(buffer).digest('hex');
  if (actualSha256 !== sha256) {
    throw messages.createError('error.templateSourceChecksumMismatch', [language, sha256, actualSha256]);
  }

  const repoName = repo.split('/')[1];
  const prefix = `${repoName}-${sha}/`;
  const entries = await untarGzip(buffer, language);
  debug('fetched %s@%s: %d file entries', repo, sha, Object.keys(entries).length);

  const stripped: Record<string, Buffer> = {};
  for (const [name, data] of Object.entries(entries)) {
    if (name.startsWith(prefix)) {
      stripped[name.slice(prefix.length)] = data;
    }
  }
  return stripped;
};

// Decompress and read every file entry (directory entries are skipped) into memory, keyed by
// its full in-tarball name. Wraps decompression/parse failures as error.templateSourceMalformed
// rather than letting a raw zlib/tar-stream error reach the user -- mirrors computeBundle.ts's
// untarGzip, which establishes the same idiom for the deploy-bundle tarball.
function untarGzip(buffer: Buffer, language: Language): Promise<Record<string, Buffer>> {
  return new Promise((resolveEntries, reject) => {
    let decompressed: Buffer;
    try {
      decompressed = gunzipSync(buffer);
    } catch {
      reject(messages.createError('error.templateSourceMalformed', [language, 'not a valid gzip archive']));
      return;
    }

    const entries: Record<string, Buffer> = {};
    const extract = tarStream.extract();
    extract.on('entry', (header, stream, next) => {
      if (header.type !== 'file') {
        stream.resume();
        next();
        return;
      }
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: unknown) => chunks.push(chunk as Buffer));
      stream.on('end', () => {
        entries[header.name] = Buffer.concat(chunks);
        next();
      });
      stream.on('error', reject);
      stream.resume();
    });
    extract.on('finish', () => resolveEntries(entries));
    extract.on('error', () =>
      reject(messages.createError('error.templateSourceMalformed', [language, 'not a valid tar archive']))
    );
    extract.end(decompressed);
  });
}
