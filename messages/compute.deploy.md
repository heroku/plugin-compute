# summary

Deploy a compute app's source and metadata to an org.

# description

Packages the compute app's source (everything under its directory except the
compute metadata file, project.toml, and .forceignore) together with its
api-spec.yaml into a deployment bundle, uploads it to the org through the
Connect API, then deploys the app's <name>.compute-meta.xml through the
Metadata API to trigger the build. The metadata deploy itself returns a job
ID that can be checked independently with "sf project deploy report
--job-id <id>". Deploy is asynchronous: this command returns once the build
has been enqueued, it doesn't wait for the build to finish.

Files matching patterns in a .forceignore are excluded from the source
bundle. Both the compute app's own .forceignore and the one at the project
root (next to sfdx-project.json) are applied, if present.

# flags.source-dir.summary

Directory containing the compute app to deploy. Defaults to the current directory.

# examples

- Deploy a compute app to an org, from inside the app's own directory:

  cd force-app/main/default/platformComputeApps/CreditRatingScorer

  <%= config.bin %> <%= command.id %> --target-org my-org

- Deploy a compute app to an org, from anywhere, by pointing --source-dir at it:

  <%= config.bin %> <%= command.id %> --source-dir force-app/main/default/platformComputeApps/CreditRatingScorer --target-org my-org

# error.notAppDir

This directory has no %s.compute-meta.xml. Run this command from inside the compute app's own directory (the one "sf compute generate" created).

# error.notAppDir.actions

- cd into the compute app's directory (e.g. force-app/main/default/platformComputeApps/<AppName>) and run the command again.
- Run sf compute generate first if the app hasn't been scaffolded yet.

# error.noProcfile

%s has no Procfile. A compute app needs a Procfile to define how it starts.

# error.noProcfile.actions

- Add a Procfile to the app directory before deploying.

# error.noApiSpec

%s has no api-spec.yaml. A compute app needs an OpenAPI spec to describe its external service.

# error.noApiSpec.actions

- Add an api-spec.yaml to the app directory before deploying.

# info.preparing

Preparing deployment for %s...

# info.packaging

packaging source (%s files, %s)... done

# info.uploading

uploading source... done

# info.deployingMetadata

Deploying metadata to %s...

# info.deployedMetaFile

%s... done (%s)

# info.buildEnqueued

Build enqueued.
