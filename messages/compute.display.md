# summary

Show the current org-side status of a deployed compute app.

# description

Queries the org for the compute app's current deployment status: its master
label, description, and overall status. With --verbose, also shows whether
an external service has been registered for it (and whether it's active),
plus the phase, timestamps, and error detail of its current build.

This is a read-only, live lookup by --name (the app's DeveloperName) -- it
doesn't read from or require a local Salesforce DX project.

# flags.name.summary

Name of the compute app to show status for.

# flags.verbose.summary

Also show external service registration and current build detail.

# examples

- Show the current status of a compute app:

  <%= config.bin %> <%= command.id %> --name LeaseAgreementParser --target-org my-org

- Include external service and current build detail:

  <%= config.bin %> <%= command.id %> --name LeaseAgreementParser --target-org my-org --verbose
