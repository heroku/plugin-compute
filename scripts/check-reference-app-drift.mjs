#!/usr/bin/env node
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

// Maintenance-only: checks whether the commit SHAs pinned in computeGenerateSource.ts have
// fallen behind their reference repos' current HEAD on GitHub. Run manually or via CI
// (.github/workflows/checkReferenceAppDrift.yml) -- never called from `sf compute generate`
// itself, so customers never pay for this extra GitHub API round-trip.
import { REFERENCE_APPS } from '../lib/shared/computeGenerateSource.js';

let stale = false;

for (const [language, { repo, sha }] of Object.entries(REFERENCE_APPS)) {
  const response = await fetch(`https://api.github.com/repos/${repo}/commits/main`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!response.ok) {
    throw new Error(`Couldn't check ${repo}'s HEAD commit: HTTP ${response.status}`);
  }
  const { sha: headSha } = /** @type {{ sha: string }} */ (await response.json());

  if (headSha === sha) {
    console.log(`${language}: ${repo} is up to date (${sha}).`);
  } else {
    stale = true;
    console.log(
      `${language}: ${repo} has moved on -- pinned ${sha}, HEAD is now ${headSha}.\n` +
        '  Update the sha and sha256 in src/shared/computeGenerateSource.ts:' +
        `\n    curl -sL https://codeload.github.com/${repo}/tar.gz/${headSha} | sha256sum`
    );
  }
}

if (stale) {
  process.exitCode = 1;
}
