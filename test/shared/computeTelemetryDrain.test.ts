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
  parseHeaderFlags,
  PUBLIC_TRANSPORTS,
  TELEMETRY_SIGNALS,
  TELEMETRY_TRANSPORTS,
  toTelemetryDrainResult,
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
    expect(() => exporterTypeForTransport('kafka')).toThrow('http, grpc');
  });

  it('keeps the hidden splunk transport out of the error text and hint but still accepts it', () => {
    expect([...PUBLIC_TRANSPORTS]).toEqual(['http', 'grpc']);
    let error: (Error & {actions?: string[]}) | undefined;
    try {
      exporterTypeForTransport('kafka');
    } catch (error_) {
      error = error_ as Error & {actions?: string[]};
    }

    expect(error?.message).not.toMatch(/splunk/iv);
    expect(error?.actions?.join(' ')).not.toMatch(/splunk/iv);
    expect(error?.actions?.join(' ')).toContain('http, grpc');
    expect(exporterTypeForTransport('splunk')).toBe('splunk');
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
      // Header values are masked in the table (keys stay) so a secret can't leak into scrollback.
      {key: 'Headers', value: '{"x-api-key":"<redacted>"}'},
    ]);
  });

  it('masks every header value but keeps the keys, without mutating the drain', () => {
    const headers = {Authorization: 'Bearer t0ken', 'X-HEC': 'hec-secret'};

    const rows = formatTelemetryDrainRows(
      {exporter: {type: 'splunk', endpoint: 'https://x', headers}},
      'CreditRatingScorer',
    );

    expect(rows.find(r => r.key === 'Headers')?.value).toBe('{"Authorization":"<redacted>","X-HEC":"<redacted>"}');
    // The headers object feeds both the table and the --json result mapping, so it must be left intact.
    expect(headers).toEqual({Authorization: 'Bearer t0ken', 'X-HEC': 'hec-secret'});
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

describe('computeTelemetryDrain.parseHeaderFlags', () => {
  it('parses key=value pairs into a headers object', () => {
    expect(parseHeaderFlags(['x-api-key=secret', 'x-team=compute'])).toEqual({
      'x-api-key': 'secret',
      'x-team': 'compute',
    });
  });

  it('splits on the first = only, so values may contain =', () => {
    expect(parseHeaderFlags(['authorization=Bearer abc=='])).toEqual({authorization: 'Bearer abc=='});
  });

  it('allows an empty value but not an empty key', () => {
    expect(parseHeaderFlags(['x-empty='])).toEqual({'x-empty': ''});
    expect(() => parseHeaderFlags(['=value'])).toThrow(/key=value/v);
  });

  it('throws on a token with no =', () => {
    expect(() => parseHeaderFlags(['no-equals'])).toThrow(/key=value/v);
  });

  it('does not expose credentials when a malformed header is rejected', () => {
    expect(() => parseHeaderFlags(['Authorization=Bearer secret\n'])).toThrow(/key=value/v);
    expect(() => parseHeaderFlags(['Authorization=Bearer secret\n'])).not.toThrow('secret');
  });

  it('lets a repeated key win with its last value', () => {
    expect(parseHeaderFlags(['k=1', 'k=2'])).toEqual({k: '2'});
  });

  it('returns an empty object for no inputs', () => {
    expect(parseHeaderFlags([])).toEqual({});
  });
});

describe('computeTelemetryDrain.toTelemetryDrainResult', () => {
  it('flattens a drain, deriving the transport label and redacting header values', () => {
    expect(
      toTelemetryDrainResult({
        id: 'drain-1',
        signals: ['traces'],
        exporter: {type: 'otlp', endpoint: 'https://c.example.com:4317', headers: {k: 'v'}},
      }),
    ).toEqual({
      id: 'drain-1',
      signals: ['traces'],
      endpoint: 'https://c.example.com:4317',
      exporterType: 'otlp',
      transport: 'gRPC',
      headers: {k: '<redacted>'},
    });
  });

  it('defaults absent fields (signals to [], the rest undefined)', () => {
    expect(toTelemetryDrainResult({id: 'drain-2'})).toEqual({
      id: 'drain-2',
      signals: [],
      endpoint: undefined,
      exporterType: undefined,
      transport: undefined,
      headers: undefined,
    });
  });
});
