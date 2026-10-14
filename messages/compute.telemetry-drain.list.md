# summary

List the telemetry drains configured for a compute app.

# description

Shows every OpenTelemetry drain forwarding the compute app's logs, metrics,
and traces, with each drain's ID, signals, and endpoint. Goes through the
target org's Salesforce Connect API, which calls Heroku on your behalf. Use
sf compute telemetry-drain get to see the full detail of a single drain.

This is a read-only, live lookup by --name (the app's DeveloperName) -- it
doesn't read from or require a local Salesforce DX project.

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
