# summary

List the compute apps deployed in an org.

# description

Queries the org for every compute app (PlatformComputeApp). The table shows
each app's master label, status, and status reason; for description, external
service registration, and current build detail on a single app, use compute
display (the full detail is also available here via --json).

This is a read-only, live lookup -- it doesn't read from or require a local
Salesforce DX project.

# info.noAppsFound

No compute apps were found in the org.

# examples

- List the compute apps in an org:

  <%= config.bin %> <%= command.id %> --target-org my-org
