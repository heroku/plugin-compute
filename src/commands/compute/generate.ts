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

// Starter source is fetched live from the Heroku AppLink getting-started reference apps
// (applink-getting-started-nodejs / applink-getting-started-python) at generate time -- see
// computeGenerateSource.ts for the pinned commit/checksum and the fetch-and-extract mechanics.
//
// Files carrying the reference apps' example business-logic endpoints (Accounts query,
// UnitOfWork, Data Cloud webhook) aren't separable from that logic by trimming -- it's woven
// into route/router registration, OpenAPI paths, and README prose, not appended after some
// boilerplate. Those paths are always replaced with a hand-authored skeleton (see
// computeGenerateSkeletons.ts) that keeps the same bootstrap/routing/middleware pattern with a
// commented worked example, so customers write their own routes/routers into it. project.toml
// has no upstream equivalent at all (those repos don't ship one) and is generated the same way.
//
// Everything else -- Procfile, the Fastify bootstrap/plugin files, package.json/requirements.txt
// (each lightly transformed to drop dev/test-only entries) -- is kept from the fetched source,
// so this repo carries zero vendored copies of upstream's code.
const FETCHED_FILES: Record<Language, Record<string, ((raw: Buffer) => string) | undefined>> = {
  node: {
    Procfile: undefined,
    'src/app.js': undefined,
    'src/plugins/heroku-applink.js': undefined,
    'package.json': transformNodePackageJson,
  },
  python: {
    Procfile: undefined,
    'requirements.txt': transformPythonRequirements,
  },
};

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
  for (const [relativePath, transform] of Object.entries(FETCHED_FILES[language])) {
    const raw = fetched[relativePath];
    if (!raw) {
      throw messages.createError('error.templateSourceMissingFile', [language, relativePath]);
    }

    files[relativePath] = transform ? transform(raw) : raw.toString('utf8');
  }

  for (const [relativePath, contents] of Object.entries(GENERATED_SKELETONS[language])) {
    files[relativePath] = contents;
  }

  for (const [relativePath, contents] of Object.entries(files)) {
    files[relativePath] = contents
      .replaceAll('__APP_NAME_LOWER__', name.toLowerCase())
      .replaceAll('__APP_NAME__', name);
  }

  return files;
}

// Keeps package.json's runtime shape (module type, entry point, start/dev scripts, license,
// engines, dependencies) while dropping devDependencies and the lint/format/test scripts that
// only make sense inside the reference app's own repo, and renaming/redescribing the package for
// the generated app.
function transformNodePackageJson(raw: Buffer): string {
  const upstream = JSON.parse(raw.toString('utf8')) as {
    dependencies?: Record<string, string>;
    engines?: Record<string, string>;
    license?: string;
    main?: string;
    scripts?: Record<string, string>;
    type?: string;
  };
  const pkg = {
    name: '__APP_NAME_LOWER__',
    version: '1.0.0',
    description: 'Compute app generated by sf compute generate, built on the Heroku AppLink Node.js starter.',
    type: upstream.type,
    main: upstream.main,
    scripts: {
      start: upstream.scripts?.start,
      dev: upstream.scripts?.dev,
    },
    license: upstream.license,
    engines: upstream.engines,
    dependencies: upstream.dependencies,
  };
  return JSON.stringify(pkg, null, 2) + '\n';
}

// requirements.txt lists runtime and test dependencies on separate lines with no section
// markers, so the only reliable split is an explicit runtime-package allowlist rather than a
// positional/comment-based cut.
const PYTHON_RUNTIME_PACKAGES = new Set(['fastapi', 'heroku-applink', 'pyyaml', 'uvicorn']);

function transformPythonRequirements(raw: Buffer): string {
  const lines = raw
    .toString('utf8')
    .split('\n')
    .filter(line => {
      const packageName = /^[A-Za-z0-9_.-]+/.exec(line.trim())?.[0];
      return packageName !== undefined && PYTHON_RUNTIME_PACKAGES.has(packageName.toLowerCase());
    });
  return lines.join('\n') + '\n';
}
