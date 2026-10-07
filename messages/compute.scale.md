# summary

Resize or rescale a compute app's dyno formation.

# description

Updates a single process type's dyno size and/or quantity for a deployed
compute app. Pass the process type with --process-type and at least one of
--quantity or --size. This goes through the target org's Salesforce Connect
API, which calls Heroku on your behalf.

# flags.process-type.summary

Process type to scale, for example web or worker.

# flags.quantity.summary

Number of dynos to run for the process type (0 stops all dynos of that type).

# flags.size.summary

Dyno size to run the process type on, for example dyno-1c-4gb.

# flags.name.summary

DeveloperName of the compute app to scale (or <namespace>\_\_<developerName>
if it was deployed under a namespace). Defaults to the COMPUTE_APP_NAME
environment variable, or the current directory's app name if that isn't set
either.

# examples

- Change a process type's dyno size:

  <%= config.bin %> <%= command.id %> --process-type web --size dyno-2c-8gb --name CreditRatingScorer --target-org my-org

- Scale a process type's dyno count:

  <%= config.bin %> <%= command.id %> --process-type worker --quantity 3 --name CreditRatingScorer --target-org my-org

- Change size and quantity together:

  <%= config.bin %> <%= command.id %> --process-type web --quantity 2 --size dyno-4c-16gb --name CreditRatingScorer --target-org my-org

- Stop all dynos of a process type:

  <%= config.bin %> <%= command.id %> --process-type worker --quantity 0 --name CreditRatingScorer --target-org my-org

# error.scaleInvalidProcessType

"%s" isn't a valid process type.

# error.scaleInvalidProcessType.actions

- Use a process type made up of letters, numbers, hyphens, or underscores, for example web or worker.

# error.scaleNoChange

Specify a quantity and/or size to scale "%s" to.

# error.scaleNoChange.actions

- Add --quantity, --size, or both, for example --quantity 2 or --size dyno-1c-4gb.

# error.scaleInvalidSize

"%s" is not a valid size. Valid sizes: %s.
