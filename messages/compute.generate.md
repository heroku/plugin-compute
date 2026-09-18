# summary

Scaffold a new compute app into your Salesforce DX project.

# description

Creates the app directory under force-app/main/default/platformComputeApps/<name>/ (or
--output-dir) with a compute metadata file, a Procfile, a project.toml, and
starter source in the language you choose with --language. This command runs
entirely locally; no org is contacted.

# flags.name.summary

Name for the new compute app.

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

# info.generating

Generating compute app %s...

# info.created

created %s

# info.done

Created compute app %s.
