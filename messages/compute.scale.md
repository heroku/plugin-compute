# summary

Resize or rescale a compute app's dyno formation.

# description

Updates one or more process types' dyno size and/or quantity for a deployed
compute app. Pass one target per process type in the form
type[=count][:size], for example web=2 or web:dyno-1c-4gb or
web=2:dyno-1c-4gb. This goes through the target org's Salesforce Connect API,
which calls Heroku on your behalf.

# args.target.summary

Process type to scale, in the form type[=count][:size] (for example web=2,
web:dyno-1c-4gb, or web=2:dyno-1c-4gb). Pass more than one to scale multiple
process types in one command.

# flags.name.summary

PlatformComputeApp Id or DeveloperName of the compute app to scale. Defaults
to the COMPUTE_APP_NAME environment variable, or the current directory's app
name if that isn't set either.

# examples

- Change a process type's dyno size:

  <%= config.bin %> <%= command.id %> web:dyno-2c-8gb --name CreditRatingScorer --target-org my-org

- Scale a process type's dyno count:

  <%= config.bin %> <%= command.id %> worker=3 --name CreditRatingScorer --target-org my-org

- Change size and quantity together:

  <%= config.bin %> <%= command.id %> web=2:dyno-4c-16gb --name CreditRatingScorer --target-org my-org

- Scale multiple process types in one command:

  <%= config.bin %> <%= command.id %> web=2:dyno-4c-16gb worker=1:dyno-1c-0.5gb --name CreditRatingScorer --target-org my-org

- Stop all dynos of a process type:

  <%= config.bin %> <%= command.id %> worker=0 --name CreditRatingScorer --target-org my-org

# error.scaleNoTargetsSpecified

Specify at least one process type to scale, for example web=2.

# error.scaleNoTargetsSpecified.actions

- Run the command again with at least one type[=count][:size] target.

# error.scaleInvalidTarget

"%s" isn't a valid scale target.

# error.scaleInvalidTarget.actions

- Use the format type[=count][:size], for example web=2, web:dyno-1c-4gb, or web=2:dyno-1c-4gb.

# error.scaleNoChangeForTarget

"%s" doesn't specify a count or size to scale to.

# error.scaleNoChangeForTarget.actions

- Add a count and/or size, for example web=2, web:dyno-1c-4gb, or web=2:dyno-1c-4gb.

# error.scaleInvalidSize

"%s" is not a valid size. Valid sizes: %s.
