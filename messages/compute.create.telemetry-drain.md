# summary

Add a telemetry drain to a compute app.

# description

Creates an OpenTelemetry drain that forwards the compute app's logs, metrics,
and traces to the endpoint you give with --url. Choose which signals to
forward with --signals and the wire protocol with --transport. Use
sf compute update telemetry-drain to change a drain later.

# flags.name.summary

DeveloperName of the compute app to add the drain to (or
<namespace>\_\_<developerName> if it was deployed under a namespace).
Defaults to the COMPUTE_APP_NAME environment variable, or the current
directory's app name if that isn't set either.

# flags.url.summary

Endpoint to forward telemetry to.

# flags.signals.summary

Comma-separated signals to forward: traces, metrics, logs, or all.

# flags.transport.summary

Wire protocol to use: http (OTLP over HTTP) or grpc (OTLP over gRPC).

# flags.header.summary

Header to send with each export, as key=value.

# flags.header.description

Repeat the flag to send more than one header. Header values often carry
credentials; they are sent to the endpoint and are never printed to the
terminal or --json output; header keys are preserved with redacted values.

# info.created

Created telemetry drain %s for %s.

# examples

- Forward all signals from a compute app to an OTLP/HTTP collector:

  <%= config.bin %> <%= command.id %> --name CreditRatingScorer --url https://collector.example.com:4318 --target-org my-org

- Forward only traces and logs over gRPC, with an auth header:

  <%= config.bin %> <%= command.id %> --name CreditRatingScorer --url https://collector.example.com:4317 --transport grpc --signals traces,logs --header "x-api-key=my-key" --target-org my-org
