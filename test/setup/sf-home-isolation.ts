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
import {mkdirSync, mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

/*
 * Give every vitest test file its own home directory, then pre-seed that home's
 * `@salesforce/core` alias store so the accessor's cold-create path never runs.
 *
 * `@salesforce/core` resolves its state dir from `os.homedir()` with no env
 * override (`aliasAccessor.getFileLocation()` -> `join(homedir(), '.sfdx',
 * 'alias.json')`) -- that's `HOME` on POSIX and `USERPROFILE` on Windows.
 * Relocating both per test file (below) stops *cross-file* contention, but it
 * does NOT stop the race that actually flakes Windows CI, because that race is
 * within a single home:
 *
 *   `AliasAccessor.readFileToAliasStore()` reads `alias.json`; if it's missing
 *   it falls into an ENOENT branch that `writeFile`s an empty store. `writeFile`
 *   truncates-then-writes, so the file briefly exists at 0 bytes. When a cold
 *   home has two concurrent `Org.init()` -> `StateAggregator.init()` ->
 *   `AliasAccessor.init()` callers (e.g. a command that resolves orgs in
 *   parallel), one creates the file while the other reads it mid-write and gets
 *   `''` -> `JSON.parse('')` -> "Unexpected end of JSON input"
 *   (`fileContentsRawToAliasStore` has no empty-contents guard). Windows'
 *   non-atomic file semantics widen the window; it's latent on all platforms.
 *
 * Seeding a valid `{"orgs":{}}` up front means the ENOENT cold-create branch is
 * never taken, so the 0-byte window never exists and every reader parses valid
 * JSON. (`'orgs'` is aliasAccessor's DEFAULT_GROUP; the shape matches
 * `aliasStoreToRawFileContents(new Map())`.)
 *
 * This file runs via `setupFiles`, so it executes once per test file (not once
 * per worker). `mkdtempSync` mints a fresh unique home each time; the worker id
 * in the prefix is only for human-readable debugging. The dirs live under the OS
 * temp dir and are reclaimed by the OS -- no explicit teardown.
 */
const workerId = process.env.VITEST_WORKER_ID ?? '0';
const isolatedHome = mkdtempSync(join(tmpdir(), `plugin-compute-sfhome-${workerId}-`));

process.env.HOME = isolatedHome;
process.env.USERPROFILE = isolatedHome;

// Pre-seed the alias store so AliasAccessor never runs its cold-create writeFile.
const sfdxDir = join(isolatedHome, '.sfdx');
mkdirSync(sfdxDir, {recursive: true});
writeFileSync(join(sfdxDir, 'alias.json'), JSON.stringify({orgs: {}}));
