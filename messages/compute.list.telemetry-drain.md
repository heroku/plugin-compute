# summary

List the telemetry drains configured for a compute app.

# description

Shows every OpenTelemetry drain forwarding the compute app's logs, metrics,
and traces, with each drain's ID, signals, and endpoint. Use
sf compute display telemetry-drain to see the full detail of a single drain.

# flags.name.summary

DeveloperName of the compute app to list telemetry drains for (or
<namespace>\_\_<developerName> if it was deployed under a namespace).
Defaults to the COMPUTE_APP_NAME environment variable, or the current
directory's app name if that isn't set either.

# info.noDrainsFound

No telemetry drains are configured for %s.

# examples

- List the telemetry drains for a compute app:

  <%= config.bin %> <%= command.id %> --name CreditRatingScorer --target-org my-org
