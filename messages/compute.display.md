# summary

Show the current org-side status of a deployed compute app.

# description

Queries the org for the compute app's current deployment status: its master
label, description, and overall status. With --verbose, also shows whether
an external service has been registered for it (and whether it's active),
plus the phase, timestamps, and error detail of its current build.

This is a read-only, live lookup by --name (the app's DeveloperName) -- it
doesn't read from or require a local Salesforce DX project.

If the HEROKU_API_TOKEN environment variable is set, this command also calls
the Heroku Platform API directly to show the app's dyno formation (process
type, dyno size, and count) alongside the org-side status above. A failure
to reach Heroku only produces a warning -- the org-side status is always shown.

# flags.name.summary

Name of the compute app to show status for. Defaults to the COMPUTE_APP_NAME
environment variable, or the current directory's app name if that isn't set
either.

# flags.verbose.summary

Also show external service registration and current build detail.

# warning.herokuFormationUnavailable

Couldn't fetch dyno formation from Heroku: %s

# examples

- Show the current status of a compute app:

  <%= config.bin %> <%= command.id %> --name CreditRatingScorer --target-org my-org

- Include external service and current build detail:

  <%= config.bin %> <%= command.id %> --name CreditRatingScorer --target-org my-org --verbose
