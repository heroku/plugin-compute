# summary

Scaffold a new compute app into your Salesforce DX project.

# description

Creates the app directory under force-app/main/default/platformComputeApps/<name>/ (or
--output-dir) with a compute metadata file, a Procfile, a project.toml, and
starter source in the language you choose with --language. No org is
contacted, but this command does fetch the starter source for the chosen
language from its Heroku AppLink reference app on GitHub, so it requires
outbound network access.

This command is deprecated but still works. When you move to sf template generate
project --template compute, note that --language no longer defaults to node: the
replacement's --compute-language flag makes the language an explicit choice.

# deprecation.message

This command will be available as sf template generate project --template compute in version 1.0.0 of plugin-compute.

# flags.name.summary

Name for the new compute app. Use <namespace>\_\_<developerName> to scaffold
it under a namespace.

# flags.output-dir.summary

Directory to create the app in.

# flags.output-dir.description

Defaults to force-app/main/default/platformComputeApps. The app itself is created in a
subdirectory named after --name.

# flags.language.summary

Language to scaffold the starter project in.

# flags.language.description

Compute apps can run any Heroku-supported language, but generate currently
scaffolds starters for node and python only.

# examples

- Scaffold a Node.js compute app named CreditRatingScorer:

  <%= config.bin %> <%= command.id %> --name CreditRatingScorer

- Scaffold a Python compute app into a custom directory:

  <%= config.bin %> <%= command.id %> --name ReceiptOcr --language python --output-dir force-app/main/default/platformComputeApps/scorers

# error.appAlreadyExists

A compute app named %s already exists at %s. Choose a different name or remove the existing directory.

# error.appAlreadyExists.actions

- Choose a different --name.
- Remove the existing directory and run this command again.

# error.templateSourceMissingFile

The %s starter source is missing an expected file: %s.

# error.templateSourceMissingFile.actions

- This plugin's pinned reference commit may be out of date with the upstream repo's layout; file an issue against @heroku/plugin-compute.

# info.generating

Generating compute app %s...

# info.created

created %s

# info.done

Created compute app %s.
