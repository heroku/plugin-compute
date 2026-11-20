# summary

Retrieve a compute app's source and metadata from an org into your local Salesforce DX project.

# description

Creates the compute app's directory under force-app/main/default/computeApps/<name>/
(or --output-dir), retrieves its <name>.computeApp-meta.xml through the Metadata
API, then downloads its source code through the Connect API and extracts it
into that same directory. Deploy it with project deploy start.

This command is deprecated but still works. To retrieve a compute app with the
replacement today, install the deploy-retrieve plugin (sf plugins install
@salesforce/plugin-deploy-retrieve@compute), then run sf project retrieve start
--metadata ComputeApp:<app-name>.

# deprecation.message

This command will be available as sf project retrieve start in version 1.0.0 of plugin-compute. Until then, run sf plugins install @salesforce/plugin-deploy-retrieve@compute, then sf project retrieve start --metadata ComputeApp:<app-name> --target-org <org>.

# flags.name.summary

DeveloperName of the compute app to retrieve (or <namespace>\_\_<developerName>
if it was deployed under a namespace).

# flags.output-dir.summary

Directory to create the app in.

# flags.output-dir.description

Defaults to force-app/main/default/computeApps. The app itself is created in a
subdirectory named after --name.

# examples

- Retrieve a compute app's source and metadata from an org:

  <%= config.bin %> <%= command.id %> --name CreditRatingScorer --target-org my-org

# error.appAlreadyExists

A directory named %s already exists at %s. Choose a different --output-dir, or remove the existing directory and run this command again.

# error.appAlreadyExists.actions

- Choose a different --output-dir.
- Remove the existing directory and run this command again.

# info.retrieving

Retrieving compute app %s from %s...

# info.retrievedMetadata

retrieved %s

# info.downloadingSource

Downloading source...

# info.extractedSource

extracted %s files

# info.done

Retrieved compute app %s into %s.

# warning.cleanupFailed

Retrieving the compute app failed, and the partially written directory %s could not be removed (%s). Delete it before running this command again, or it will stop with "already exists".
