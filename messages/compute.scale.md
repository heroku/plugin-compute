# summary

Resize or rescale a compute app's dyno formation.

# description

Updates one or more process types' dyno size and/or quantity for a deployed
compute app. Pass one target per process type in the form
type[=count][:size], for example web=2 or web:eco or web=2:eco. By default
this goes through the target org's Salesforce Connect API, which calls
Heroku on your behalf. If HEROKU_API_TOKEN is set, the command bypasses the
org and calls the Heroku Platform API directly instead, using --name as the
Heroku app Id or name.

# args.target.summary

Process type to scale, in the form type[=count][:size] (for example web=2,
web:eco, or web=2:eco). Pass more than one to scale multiple process types
in one command.

# flags.name.summary

PlatformComputeApp Id or DeveloperName of the compute app to scale (or the
Heroku app Id/name, when HEROKU_API_TOKEN is set). Defaults to the
COMPUTE_APP_NAME environment variable, or the current directory's app name
if that isn't set either.

# examples

- Change a process type's dyno size:

  <%= config.bin %> <%= command.id %> web:standard-1x --name CreditRatingScorer --target-org my-org

- Scale a process type's dyno count:

  <%= config.bin %> <%= command.id %> worker=3 --name CreditRatingScorer --target-org my-org

- Change size and quantity together:

  <%= config.bin %> <%= command.id %> web=2:standard-2x --name CreditRatingScorer --target-org my-org

- Scale multiple process types in one command:

  <%= config.bin %> <%= command.id %> web=2:standard-2x worker=1:eco --name CreditRatingScorer --target-org my-org

- Stop all dynos of a process type:

  <%= config.bin %> <%= command.id %> worker=0 --name CreditRatingScorer --target-org my-org

# error.scaleNoTargetsSpecified

Specify at least one process type to scale, for example web=2.

# error.scaleNoTargetsSpecified.actions

- Run the command again with at least one type[=count][:size] target.

# error.scaleInvalidTarget

"%s" isn't a valid scale target.

# error.scaleInvalidTarget.actions

- Use the format type[=count][:size], for example web=2, web:eco, or web=2:eco.

# error.scaleNoChangeForTarget

"%s" doesn't specify a count or size to scale to.

# error.scaleNoChangeForTarget.actions

- Add a count and/or size, for example web=2, web:eco, or web=2:eco.

# error.scaleInvalidSize

"%s" is not a valid size. Valid sizes: %s.
