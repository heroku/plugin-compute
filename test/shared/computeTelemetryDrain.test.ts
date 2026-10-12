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

import {
  exporterTypeForTransport,
  formatTelemetryDrainRows,
  TELEMETRY_SIGNALS,
  TELEMETRY_TRANSPORTS,
  transportLabelForExporterType,
  validateAndFormatSignals,
} from '../../src/shared/computeTelemetryDrain.js';

describe('computeTelemetryDrain.validateAndFormatSignals', () => {
  it('expands the "all" keyword to every signal, in canonical order', () => {
    expect(validateAndFormatSignals('all')).toEqual(['traces', 'metrics', 'logs']);
    expect(validateAndFormatSignals('all')).toEqual([...TELEMETRY_SIGNALS]);
  });

  it('accepts each individual signal', () => {
    expect(validateAndFormatSignals('traces')).toEqual(['traces']);
    expect(validateAndFormatSignals('metrics')).toEqual(['metrics']);
    expect(validateAndFormatSignals('logs')).toEqual(['logs']);
  });

  it('accepts a comma-separated subset, preserving the given order', () => {
    expect(validateAndFormatSignals('logs,traces')).toEqual(['logs', 'traces']);
  });

  // The next four lock the deliberately-faithful heroku/cli port: case-sensitive, non-trimming, and
  // "all" valid only as the whole input. See the decision comment in computeTelemetryDrain.ts.
  it('throws on the empty string (no implicit "all")', () => {
    expect(() => validateAndFormatSignals('')).toThrow("isn't valid");
  });

  it('throws on an unknown signal', () => {
    expect(() => validateAndFormatSignals('foo')).toThrow('"foo"');
  });

  it('is case-sensitive and does not trim', () => {
    expect(() => validateAndFormatSignals('Traces')).toThrow("isn't valid");
    expect(() => validateAndFormatSignals(' traces')).toThrow("isn't valid");
    expect(() => validateAndFormatSignals('traces, metrics')).toThrow("isn't valid");
  });

  it('treats "all" only as the whole input, never as a list element', () => {
    expect(() => validateAndFormatSignals('all,logs')).toThrow('"all"');
  });
});

describe('computeTelemetryDrain.exporterTypeForTransport', () => {
  it('maps each supported transport onto its Heroku exporter type', () => {
    expect(exporterTypeForTransport('grpc')).toBe('otlp');
    expect(exporterTypeForTransport('http')).toBe('otlphttp');
    expect(exporterTypeForTransport('splunk')).toBe('splunk');
  });

  it('exposes the supported transports', () => {
    expect([...TELEMETRY_TRANSPORTS]).toEqual(['grpc', 'http', 'splunk']);
  });

  it('throws on an unknown transport, naming the valid set', () => {
    expect(() => exporterTypeForTransport('kafka')).toThrow('"kafka"');
    expect(() => exporterTypeForTransport('kafka')).toThrow('grpc, http, splunk');
  });

  it('is case-sensitive and does not trim', () => {
    expect(() => exporterTypeForTransport('HTTP')).toThrow("isn't valid");
    expect(() => exporterTypeForTransport(' http')).toThrow("isn't valid");
  });
});

describe('computeTelemetryDrain.transportLabelForExporterType', () => {
  it('labels otlp as gRPC and everything else as HTTP', () => {
    expect(transportLabelForExporterType('otlp')).toBe('gRPC');
    expect(transportLabelForExporterType('otlphttp')).toBe('HTTP');
    expect(transportLabelForExporterType('splunk')).toBe('HTTP');
  });
});

describe('computeTelemetryDrain.formatTelemetryDrainRows', () => {
  it('renders a fully-populated drain, deriving the transport label and joining signals', () => {
    const rows = formatTelemetryDrainRows(
      {
        id: '01234567-89ab-cdef-0123-456789abcdef',
        signals: ['traces', 'logs'],
        exporter: {
          type: 'otlp',
          endpoint: 'https://collector.example.com:4317',
          headers: {'x-api-key': 'secret'},
        },
      },
      'CreditRatingScorer',
    );

    expect(rows).toEqual([
      {key: 'App', value: 'CreditRatingScorer'},
      {key: 'Signals', value: 'traces, logs'},
      {key: 'Endpoint', value: 'https://collector.example.com:4317'},
      {key: 'Transport', value: 'gRPC'},
      {key: 'Headers', value: '{"x-api-key":"secret"}'},
    ]);
  });

  it('falls back to a dash for every absent/empty field', () => {
    const rows = formatTelemetryDrainRows({}, 'CreditRatingScorer');

    expect(rows).toEqual([
      {key: 'App', value: 'CreditRatingScorer'},
      {key: 'Signals', value: '-'},
      {key: 'Endpoint', value: '-'},
      {key: 'Transport', value: '-'},
      {key: 'Headers', value: '-'},
    ]);
  });

  it('treats an empty signals array and an empty headers object as a dash', () => {
    const rows = formatTelemetryDrainRows(
      {signals: [], exporter: {type: 'otlphttp', endpoint: 'https://x', headers: {}}},
      'CreditRatingScorer',
    );

    expect(rows.find(r => r.key === 'Signals')?.value).toBe('-');
    expect(rows.find(r => r.key === 'Headers')?.value).toBe('-');
    expect(rows.find(r => r.key === 'Transport')?.value).toBe('HTTP');
  });
});
