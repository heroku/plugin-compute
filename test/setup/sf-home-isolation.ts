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
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

/*
 * Give every vitest worker its own home directory so the `@salesforce/core`
 * state dir (`~/.sf`, which holds `alias.json`) is isolated per worker.
 *
 * `@salesforce/core` resolves its state dir from `os.homedir()` with no env
 * override -- that's `HOME` on POSIX and `USERPROFILE` on Windows. vitest runs
 * test files across parallel worker processes that all inherit the same home,
 * so every file's `$$.stubAuths()` / `Org.create()` reads and writes the SAME
 * `alias.json`. On Windows a worker can read that file while another is mid-write
 * and hit `JSON.parse('')` -> "Unexpected end of JSON input" (the raw parse in
 * aliasAccessor's `fileContentsRawToAliasStore` has no empty-contents guard).
 *
 * A unique home per worker removes the cross-worker contention entirely while
 * keeping files running in parallel. `mkdtempSync` guarantees uniqueness; the
 * worker id in the prefix is only for human-readable debugging. The dirs live
 * under the OS temp dir and are reclaimed by the OS -- no explicit teardown.
 */
const workerId = process.env.VITEST_WORKER_ID ?? '0';
const isolatedHome = mkdtempSync(join(tmpdir(), `plugin-compute-sfhome-${workerId}-`));

process.env.HOME = isolatedHome;
process.env.USERPROFILE = isolatedHome;
