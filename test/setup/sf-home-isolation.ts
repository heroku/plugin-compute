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
 * Give every vitest test file its own private dir, point every path
 * `@salesforce/core` uses to reach its alias store at that dir, then pre-seed
 * the store so the accessor's cold-create path never runs.
 *
 * There are TWO paths to the alias store, and the flaky Windows CI race needs
 * both covered:
 *
 *   1. Production: `AliasAccessor.getFileLocation()` -> `join(homedir(),
 *      '.sfdx', 'alias.json')` -- that's `HOME` on POSIX, `USERPROFILE` on
 *      Windows.
 *   2. Under `@salesforce/core`'s `TestContext` (the `$$ = new TestContext()`
 *      used by ~20 of our test files): `getFileLocation` is STUBBED, in the
 *      global `beforeEach`, to `join(os.tmpdir(), '.sfdx', 'alias.json')`
 *      (`testSetup.js` `getAliasFileLocation()`). `os.tmpdir()` reads `TMPDIR`
 *      on POSIX and `TEMP`/`TMP` on Windows. So for every TestContext test the
 *      store lives under the *shared* OS temp dir, NOT under homedir -- which is
 *      why relocating HOME alone never stopped the flake (PR #21): it missed the
 *      path those tests actually read.
 *
 * The race itself: `AliasAccessor.readFileToAliasStore()` reads `alias.json`;
 * if it's missing it falls into an ENOENT branch that `writeFile`s an empty
 * store. `writeFile` truncates-then-writes, so the file briefly exists at 0
 * bytes. Two concurrent `AliasAccessor.init()` callers across parallel vitest
 * workers hit the SAME shared-tmpdir file -- one creates it while another reads
 * it mid-write and gets `''` -> `JSON.parse('')` -> "Unexpected end of JSON
 * input" (`fileContentsRawToAliasStore` has no empty-contents guard). Windows'
 * non-atomic file semantics widen the window; it's latent on all platforms.
 *
 * Fix: redirect HOME/USERPROFILE *and* TMPDIR/TEMP/TMP to one per-file dir, so
 * both resolution strategies collapse onto `<isolatedDir>/.sfdx/alias.json`,
 * then seed a valid `{"orgs":{}}` there. Per-file isolation removes the
 * cross-worker sharing, and the seed means the ENOENT cold-create branch is
 * never taken, so the 0-byte window never exists. (`'orgs'` is aliasAccessor's
 * DEFAULT_GROUP; the shape matches `aliasStoreToRawFileContents(new Map())`.)
 *
 * This file runs via `setupFiles`, so it executes once per test file (not once
 * per worker). `mkdtempSync` mints a fresh unique dir each time; the worker id
 * in the prefix is only for human-readable debugging. The dirs live under the
 * real OS temp dir (resolved BEFORE we override TMPDIR below) and are reclaimed
 * by the OS -- no explicit teardown.
 */
const workerId = process.env.VITEST_WORKER_ID ?? '0';
// Create the per-file dir under the REAL OS temp dir, before overriding TMPDIR.
const isolatedDir = mkdtempSync(join(tmpdir(), `plugin-compute-sfhome-${workerId}-`));

// Homedir-based resolution (production path).
process.env.HOME = isolatedDir;
process.env.USERPROFILE = isolatedDir;
// tmpdir-based resolution (TestContext's stubbed getFileLocation). os.tmpdir()
// reads TMPDIR on POSIX, TEMP/TMP on Windows -- set all three.
process.env.TMPDIR = isolatedDir;
process.env.TEMP = isolatedDir;
process.env.TMP = isolatedDir;

// Pre-seed the alias store so AliasAccessor never runs its cold-create writeFile.
// Both paths above now resolve here, so one seeded file covers both.
const sfdxDir = join(isolatedDir, '.sfdx');
mkdirSync(sfdxDir, {recursive: true});
writeFileSync(join(sfdxDir, 'alias.json'), JSON.stringify({orgs: {}}));
