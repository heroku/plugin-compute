# summary

Retrieve a compute app's source and metadata from an org into your local Salesforce DX project.

# description

Creates the compute app's directory under force-app/main/default/platformComputeApps/<name>/
(or --output-dir), retrieves its <name>.compute-meta.xml through the Metadata
API, then downloads its source code through the Connect API and extracts it
into that same directory. This is the inverse of sf compute deploy.

# flags.name.summary

Name of the compute app to retrieve.

# flags.output-dir.summary

Directory to create the app in.

# flags.output-dir.description

Defaults to force-app/main/default/platformComputeApps. The app itself is created in a
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
