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

import {Messages} from '@salesforce/core';
import {Flags, SfCommand} from '@salesforce/sf-plugins-core';
import {mkdir, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';

import {pathExists, resolveAppDir, validateName} from '../../shared/computeApp.js';
import {GENERATED_SKELETONS} from '../../shared/computeGenerateSkeletons.js';
import {fetchTemplateSource, type FetchTemplateSource, type Language} from '../../shared/computeGenerateSource.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('@salesforce/plugin-compute', 'compute.generate');

export type ComputeGenerateResult = {
  files: string[];
  language: Language;
  name: string;
  path: string;
};

export default class Generate extends SfCommand<ComputeGenerateResult> {
  public static readonly description = messages.getMessage('description');
  public static readonly examples = messages.getMessages('examples');
  // Overridable by tests so generate.test.ts stays offline -- production always uses the real
  // fetchTemplateSource (live HTTPS fetch of the pinned reference-app commit).
  public static fetchTemplateSource: FetchTemplateSource = fetchTemplateSource;
  public static readonly flags = {
    name: Flags.string({
      char: 'n',
      required: true,
      summary: messages.getMessage('flags.name.summary'),
    }),
    'output-dir': Flags.directory({
      char: 'd',
      summary: messages.getMessage('flags.output-dir.summary'),
      description: messages.getMessage('flags.output-dir.description'),
      default: 'force-app/main/default/platformComputeApps',
    }),
    language: Flags.string({
      char: 'l',
      summary: messages.getMessage('flags.language.summary'),
      description: messages.getMessage('flags.language.description'),
      options: ['node', 'python'],
      default: 'node',
    }),
  };

  public static readonly requiresProject = true;

  public static readonly summary = messages.getMessage('summary');

  public async run(): Promise<ComputeGenerateResult> {
    const {flags} = await this.parse(Generate);
    const {name} = flags;
    const language = flags.language as Language;

    validateName(name);

    const appDir = resolveAppDir(flags['output-dir'], name);
    if (await pathExists(appDir)) {
      throw messages.createError('error.appAlreadyExists', [name, appDir]);
    }

    this.log(messages.getMessage('info.generating', [name]));

    const starterFiles = await buildStarterFiles(name, language, Generate.fetchTemplateSource);
    const writtenFiles = await Promise.all(
      Object.entries(starterFiles).map(async ([relativePath, contents]) => {
        const filePath = join(appDir, relativePath);
        await mkdir(dirname(filePath), {recursive: true});
        await writeFile(filePath, contents);
        return filePath;
      }),
    );
    for (const filePath of writtenFiles) {
      this.log(messages.getMessage('info.created', [filePath]));
    }

    this.log('');
    this.logSuccess(messages.getMessage('info.done', [name]));

    return {
      name, path: appDir, language, files: writtenFiles,
    };
  }
}

// Files that belong to the reference-app repo itself rather than to a customer's app. Governance
// files (CODEOWNERS names teams that don't exist in the customer's org; the license/security/
// conduct/contributing docs describe Heroku's repo), the Heroku deploy-button manifest
// (meaningless for a PlatformComputeApp), and the example routers/tests for the endpoints the
// skeletons replace (left in, they're dead code and their tests fail against the skeleton).
// Entries ending in "/" match a whole directory. Lint/format config stays: package.json's lint
// and format scripts still reference it.
const DENIED_COMMON = ['CODEOWNERS', 'LICENSE.txt', 'SECURITY.md', 'CODE_OF_CONDUCT.md', 'CONTRIBUTING.md'];
const DENIED_PATHS: Record<Language, string[]> = {
  node: [...DENIED_COMMON, 'app.json', 'test/routes/'],
  python: [...DENIED_COMMON, 'app/routers/', 'tests/routers/'],
};

function isDeniedPath(language: Language, relativePath: string): boolean {
  return DENIED_PATHS[language].some(entry =>
    entry.endsWith('/') ? relativePath.startsWith(entry) : relativePath === entry);
}

// Fetch-only files the generated app can't run without (nothing in GENERATED_SKELETONS covers them).
const REQUIRED_FETCHED_FILES: Record<Language, string[]> = {
  node: ['Procfile', 'package.json', 'package-lock.json', 'src/app.js', 'src/plugins/heroku-applink.js'],
  python: ['Procfile', 'requirements.txt'],
};

// bin/invoke.* is kept for local testing, but upstream defaults and examples point at the
// reference apps' example endpoints (/accounts, /unitofwork, ...) which don't exist in a
// generated app. Repoint them at routes that do: the built-in health route by default, and the
// skeleton's commented /hello example elsewhere.
const INVOKE_SCRIPTS = new Set(['bin/invoke.py', 'bin/invoke.sh']);
const INVOKE_PATH_REPLACEMENTS: Array<[string, string]> = [
  ['/api/accounts/', '/health'],
  ['/accounts', '/healthcheck'],
  ['/unitofwork', '/hello'],
];

function retargetInvokeScript(text: string): string {
  let retargeted = text;
  for (const [from, to] of INVOKE_PATH_REPLACEMENTS) {
    retargeted = retargeted.replaceAll(from, () => to);
  }

  return retargeted;
}

// Starter source is fetched live from the Heroku AppLink getting-started reference apps
// (applink-getting-started-nodejs / applink-getting-started-python) at generate time -- see
// computeGenerateSource.ts for the pinned commit/checksum and the fetch-and-extract mechanics.
// Everything the fetch returns is written out verbatim (lockfile, package.json/requirements.txt,
// lint config, local invoke scripts, etc.) except the DENIED_* paths below -- this repo carries
// zero vendored copies of upstream's code, and generated apps get the exact same lockfile-backed
// dependency set as the reference app, not a hand-trimmed subset of it. A denylist (rather than
// an allowlist) means new upstream runtime files flow through without a code change here.
//
// Files carrying the reference apps' example business-logic endpoints (Accounts query,
// UnitOfWork, Data Cloud webhook) aren't separable from that logic by trimming -- it's woven
// into route/router registration, OpenAPI paths, and README prose, not appended after some
// boilerplate. Those paths are always overwritten with a hand-authored skeleton (see
// computeGenerateSkeletons.ts) that keeps the same bootstrap/routing/middleware pattern with a
// commented worked example, so customers write their own routes/routers into it. project.toml
// has no upstream equivalent at all (those repos don't ship one) and is generated the same way.
async function buildStarterFiles(
  name: string,
  language: Language,
  fetchSource: FetchTemplateSource,
): Promise<Record<string, string>> {
  const metaXml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<PlatformComputeApp xmlns="http://soap.sforce.com/2006/04/metadata">',
    `    <masterLabel>${name}</masterLabel>`,
    '    <description>Compute app generated by sf compute generate.</description>',
    '</PlatformComputeApp>',
    '',
  ].join('\n');

  const files: Record<string, string> = {
    [`${name}.compute-meta.xml`]: metaXml,
  };

  const fetched = await fetchSource(language);
  // Fails at generate time (rather than later at `npm ci` / deploy) if a pin bump moved or removed
  // a file the app can't run without; the tarball checksum only proves the bytes are the ones
  // pinned, not that the file set still has what we expect.
  for (const requiredPath of REQUIRED_FETCHED_FILES[language]) {
    const present = fetched[requiredPath];
    if (!present) {
      throw messages.createError('error.templateSourceMissingFile', [language, requiredPath]);
    }
  }

  for (const [relativePath, raw] of Object.entries(fetched)) {
    if (isDeniedPath(language, relativePath)) continue;
    const text = raw.toString('utf8');
    files[relativePath] = INVOKE_SCRIPTS.has(relativePath) ? retargetInvokeScript(text) : text;
  }

  for (const [relativePath, contents] of Object.entries(GENERATED_SKELETONS[language])) {
    files[relativePath] = contents;
  }

  for (const [relativePath, contents] of Object.entries(files)) {
    // Replacer functions (not string literals) so a `$` in the app name is inserted verbatim
    // rather than interpreted as a replacement pattern ($&, $1, $$, ...).
    files[relativePath] = contents
      .replaceAll('__APP_NAME_LOWER__', () => name.toLowerCase())
      .replaceAll('__APP_NAME__', () => name);
  }

  return files;
}
