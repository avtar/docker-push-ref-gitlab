#!/bin/sh -e

usage () { echo "Usage: $0 <ref> <repository>"; }

if [ "$#" -ne 2 ]; then
    echo "Error: Insufficient arguments provided!"
    usage
    exit 1
fi

for arg in "$@"; do
    if [ ${#arg} -eq 0 ]; then
        echo "Error: Argument cannot be an empty string!"
        usage
        exit 1
    fi
done

REF="$1"
REPO_NAME="$2"

/usr/bin/push-ref-gitlab \
--build-events-webhook-url="${BUILD_EVENTS_WEBHOOK_URL}" \
--gitlab-instance="${GITLAB_INSTANCE_URL}" \
--github-repo-owner="${GITHUB_ACCOUNT}" \
--github-repo-name="${REPO_NAME}" \
--gitlab-repo-owner="${GITLAB_ACCOUNT}" \
--gitlab-repo-name="${REPO_NAME}" \
--ref="${REF}" \
--gitlab-token="${GITLAB_TOKEN}" \
--gitlab-runner-id="${GITLAB_CI_RUNNER_ID}" \
--cwd=/home/gitsync
