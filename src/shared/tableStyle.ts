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

// SfCommand#table() spreads getDefaults(options) *after* the caller's own options
// (@salesforce/sf-plugins-core ux/ux.js), so a per-call borderStyle is always
// clobbered by the shared boxed default ('vertical-with-outline'). The only lever
// getDefaults() actually reads is the SF_TABLE_BORDER_STYLE env var, so set it before
// the first this.table() call in every command that renders one. ??= leaves an
// operator's own explicit env var choice untouched.
export function useBorderlessTables(): void {
  process.env.SF_TABLE_BORDER_STYLE ??= 'headers-only-with-underline';
}
