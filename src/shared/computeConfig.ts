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

import {PLUGIN_NAME} from './plugin-name.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages(PLUGIN_NAME, 'compute.errors');

// Shared by `get config` and `unset config` -- both validate requested keys against the same
// fetched map and must raise byte-identical text for a missing key, so this is the one source of
// truth for that check rather than duplicating the message in each command's own .md file.
export function requireConfigVar(configVars: Record<string, string>, name: string, key: string): string {
  if (!Object.hasOwn(configVars, key)) {
    throw messages.createError('error.configVarNotFound', [name, key]);
  }

  return configVars[key];
}

// Right-pads each key to the widest key's width (plus Heroku's own two-space minimum gap) so
// values line up in a column -- shared by `list config` and multi-key `get config` so the two
// commands agree visually when run back-to-back.
export function formatConfigVarLines(configVars: Record<string, string>): string[] {
  const keys = Object.keys(configVars);
  const width = Math.max(0, ...keys.map(key => key.length));
  return keys.map(key => `${key}:${' '.repeat(width - key.length + 2)}${configVars[key]}`);
}
