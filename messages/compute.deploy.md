# summary

Deploy a compute app's source and metadata to an org.

# description

Packages the compute app's source (everything under its directory except the
compute metadata file, project.toml, and .forceignore) together with its
api-spec.yaml into a deployment bundle, uploads it to the org through the
Connect API, then
deploys the app's <name>.compute-meta.xml through the Metadata API to trigger
the build. Deploy is asynchronous: this command returns once the build has
been enqueued, it doesn't wait for the build to finish.

Files matching patterns in a .forceignore are excluded from the source
bundle. Both the compute app's own .forceignore and the one at the project
root (next to sfdx-project.json) are applied, if present.

# flags.name.summary

Name of the compute app to deploy.

# flags.output-dir.summary

Directory the compute app was generated into.

# flags.output-dir.description

Defaults to force-app/main/default/compute. Must match --output-dir from
sf compute generate for this app.

# examples

- Deploy a compute app to an org:

  <%= config.bin %> <%= command.id %> --name LeaseAgreementParser --target-org my-org

# error.appNotFound

No compute app named %s was found at %s. Run "sf compute generate" first, or check --output-dir.

# error.appNotFound.actions

- Run <%= config.bin %> compute generate --name %s to scaffold it.
- Check that --output-dir points at the right location.

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

%s... done

# info.buildEnqueued

Build enqueued.
