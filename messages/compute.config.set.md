# summary

Set one or more of a compute app's config vars.

# description

Goes through the target org's Salesforce Connect API, which calls Heroku on
your behalf. Setting a config var restarts the app's dynos so the new value
takes effect. Pass one or more KEY=VALUE pairs; a key that doesn't already
exist is created.

# args.pair.summary

Config var assignment in the form KEY=VALUE. Pass more than one to set
multiple config vars in one command. Only the first = in each pair is
treated as the separator, so a value can itself contain one.

# flags.name.summary

PlatformComputeApp Id or DeveloperName of the compute app to change config
for. Defaults to the COMPUTE_APP_NAME environment variable, or the current
directory's app name if that isn't set either.

# examples

- Set a single config var:

  <%= config.bin %> <%= command.id %> STRIPE_KEY=sk_live_xyz789 --name CreditRatingScorer --target-org my-org

- Set more than one config var in one command:

  <%= config.bin %> <%= command.id %> STRIPE_KEY=sk_live_xyz789 LOG_LEVEL=debug --name CreditRatingScorer --target-org my-org

# error.configSetNoPairsSpecified

Specify at least one config var, for example `STRIPE_KEY=sk_live_...`.

# error.configSetNoPairsSpecified.actions

- Run the command again with at least one KEY=VALUE pair.

# error.configSetInvalidPair

"%s" is not a valid KEY=VALUE pair. Use %s=value.

# error.configSetInvalidPair.actions

- Add an = and a value, for example KEY=value.
