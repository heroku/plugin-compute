# summary

Print the build/compile log for a compute app's latest build.

# description

Fetches the bounded build/compile log (dependency install, slug compile,
release) for the most recent build of a compute app -- useful right after
deploy to confirm the build compiled. This is a one-shot fetch of a
finished-or-in-progress log, not a live stream; use compute logs --tail for
the ongoing runtime log.

This is a read-only, org-mediated lookup by --name (the app's DeveloperName)
-- the org calls Heroku's Build Info API on your behalf. It doesn't read from
or require a local Salesforce DX project.

# flags.name.summary

DeveloperName of the compute app to fetch build output for (or
<namespace>\_\_<developerName> if it was deployed under a namespace).
Defaults to the COMPUTE_APP_NAME environment variable, or the current
directory's app name if that isn't set either.

# info.noBuildsFound

Compute app %s has no builds yet.

# info.buildOutputNotYetAvailable

Compute app %s's latest build (%s) hasn't produced output yet. Try again shortly.

# examples

- Print the latest build's log:

  <%= config.bin %> <%= command.id %> --name CreditRatingScorer --target-org my-org
