# About

This repository is the result of exploratory work that was carried out to test GitHub and Gitlab CI integration. The original inspiration was [a post on the sealedabstract website](http://faq.sealedabstract.com/gitlab_mirror/) and some of its configuration files and scripts have been adapted for this work. 

The contents have been used to create [a Docker container](https://hub.docker.com/r/avtar/push-ref-gitlab/) that will:

1. Use [webhook](https://github.com/adnanh/webhook/) to listen to [GitHub push events](https://developer.github.com/v3/activity/events/types/#pushevent) when changes are merged in branches
1. Pass the git ref, repository name, and a few other arguments (please refer to the environment variables below) from the payload to a [Node.js script](https://github.com/avtar/push-ref-gitlab)

The script will then:

1. Create a matching Gitlab project if one does not already exist
1. Enable up a [Gitlab CI runner](https://docs.gitlab.com/ee/ci/runners/README.html) for the project in question
1. Enable a [build events webhook](https://gitlab.com/gitlab-org/gitlab-ce/issues/4278) that will inform [webhook](https://github.com/adnanh/webhook/) of CI job progress
1. Clone the GitHub repository and set up Gitlab as a remote
1. Finally the ref specified in the original payload will be pushed to the Gitlab repository

Gitlab CI jobs will be triggered if the GitHub repository contains a [valid](https://gitlab.com/ci/lint) [.gitlab-ci.yml file](https://issues.gpii.net/browse/GPII-2123?focusedCommentId=22422&page=com.atlassian.jira.plugin.system.issuetabpanels:comment-tabpanel#comment-22422). The progress of CI jobs will be communicated using the [GitHub Status API](https://developer.github.com/v3/repos/statuses/) and also be viewable using the [Gitlab Pipelines UI](https://docs.gitlab.com/ee/ci/pipelines.html). 

### Environment Variables

In order to use the supplied container the following environment variables will need to be provided:

* ``BUILD_EVENTS_WEBHOOK_URL`` - This is a URL pointing to where the container is running, for example ``http://<FQDN>:9000/hooks/update-github-status``
* ``GITHUB_ACCOUNT`` - The GitHub account associated with the repositories that will be generating the push events
* ``GITHUB_TOKEN`` - A GitHub Personal Access Token with the ``repo:status`` scope
* ``GITLAB_ACCOUNT`` - The Gitlab account where GitHub repositories will be mirrored
* ``GITLAB_TOKEN`` - A Gitlab Personal Access Token 
* ``GITLAB_CI_RUNNER_ID`` - A Gitlab CI Runner ID (please refer to notes further below)
* ``GITLAB_INSTANCE_URL`` - ``https://gitlab.com`` should be a safe default unless a self-hosted GitLab instance is being used
* ``GITLAB_ENABLE_SHARED_RUNNERS`` - Boolean defaults to ``false``, ideally set to ``true`` if a self-hosted GitLab instance is being used

### Start a Container

A container can be started as long as the prerequisites listed below have been met.

```
sudo docker run \
-d -p 9000:9000  \
--name push-ref-gitlab \
-e BUILD_EVENTS_WEBHOOK_URL=http://<FQDN>:9000/hooks/update-github-status \
-e GITLAB_INSTANCE_URL=https://gitlab.com \
-e GITHUB_ACCOUNT=<github-account-name> \
-e GITHUB_TOKEN=<github-token> \
-e GITLAB_ACCOUNT=<gitlab-account-name> \
-e GITLAB_TOKEN=<gitlab-token> \
-e GITLAB_CI_RUNNER_ID=<gitlab-ci-runner-id> \
avtar/push-ref-gitlab
```

## Prerequisites

Before a container can be used some preparatory work is needed. The following tasks only need to be performed once unless the runner is  moved to a different host or its details change in any other way. 

After these steps any merge activity in the configured GitHub repositories will trigger Gitlab CI jobs.

### Create a GitHub Personal Access Token

Visit https://github.com/settings/tokens/ to create a new personal access token. Only the ``repo:status`` scope needs to be granted.

### Create a Gitlab Test Project

Visit https://gitlab.com/projects/new to create a temporary test project.

A project name such as ``test-project`` can be used. This project won't be used for any CI jobs, it is just need in order to obtain a CI runner token which unfortunately isn't offered by other means. If a self-hosted Gitlab instance is being used then shared CI runners would be an option and these extra steps wouldn't be required.

### Set Up a Gitlab Runner

A Gitlab Runner can be hosted on your personal computer or in a data centre. Runners will have access to secrets depending on what your CI jobs entail.

### Obtain a Gitlab CI Runner Token

Vist ``https://gitlab.com/<your-account-name>/test-project/runners`` and search for the ``Use the following registration token during setup: <runner-token>`` text. Make a note of this token.

### Install a Runner
* [macOS/OS X](https://docs.gitlab.com/runner/install/osx.html)
* [Linux](https://docs.gitlab.com/runner/install/linux-repository.html)
* [Windows](https://docs.gitlab.com/runner/install/windows.html)

### Register a Runner 

```
gitlab-ci-multi-runner register \
--non-interactive \
--registration-token "<runner-token>" \
--url "https://gitlab.com/" \
--name "<any-name-will-suffice>" \
--executor "shell"
```

### Start a Runner Interactively

The following command will start the runner in the foreground and not as a service, allowing you to observe its activity:

``gitlab-ci-multi-runner --debug run``

To stop the process you will need to type ``CTRL-C``.

### Obtain the Runner's ID

Visit ``https://gitlab.com/<your-account-name>/<your-test-project-name>/runners`` and copy the number prepended by the ``#`` character.

### Set Up a GitHub Webhook

Visit ``https://github.com/<your-account>/<your-project>/settings/hooks/new`` to create a new webhook. Each project that needs to make use of Gitlab CI will need to have these hooks configured.

* The only text field that needs to be populated is the ``Payload URL``. The URL will resemble the following example: ``http://<FQDN>:9000/hooks/sync-gitlab-mirror``

* The ``Content type`` should be set to ``application/json``.

* ``Just the push event`` should be selected.
