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

/**
 * The npm package name, used as the message-bundle key in every
 * `Messages.loadMessages(PLUGIN_NAME, ...)` call across the plugin.
 *
 * This MUST stay in sync with the `name` field in `package.json` (and the
 * `plugin` field in `command-snapshot.json`) — `@salesforce/core` resolves the
 * message directory by this name, so a mismatch throws at runtime.
 *
 * It is `@heroku/plugin-compute` while the plugin is private/pre-GA. When it
 * goes public the name switches to `@salesforce/plugin-compute`; centralizing
 * it here makes that a one-line change. See AGENTS.md ("Package name").
 */
export const PLUGIN_NAME = '@heroku/plugin-compute';
