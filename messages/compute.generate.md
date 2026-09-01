# summary

Scaffold a new compute app into your Salesforce DX project.

# description

Creates the app directory under force-app/main/default/compute/<name>/ (or
--output-dir) with a compute metadata file, a Procfile, a project.toml, and
starter source in the language you choose with --language. This command runs
entirely locally; no org is contacted.

# flags.name.summary

Name for the new compute app.

# flags.target-org.summary

Org to associate the app with (username or alias).

# flags.output-dir.summary

Directory to create the app in.

# flags.output-dir.description

Defaults to force-app/main/default/compute. The app itself is created in a
subdirectory named after --name.

# flags.language.summary

Language to scaffold the starter project in.

# flags.language.description

Compute apps can run any Heroku-supported language, but generate currently
scaffolds starters for node and python only.

# examples

- Scaffold a Node.js compute app named LeaseAgreementParser:

  <%= config.bin %> <%= command.id %> --name LeaseAgreementParser

- Scaffold a Python compute app and associate it with an org:

  <%= config.bin %> <%= command.id %> --name ReceiptOcr --language python --target-org my-org

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

# info.next

Next: sf compute deploy --name %s --target-org %s
