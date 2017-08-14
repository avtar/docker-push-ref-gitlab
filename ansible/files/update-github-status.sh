#!/bin/sh -e

usage () { echo "Usage: $0 <gitlab-state> <build-id> <sha> <build-stage> <repository>"; }

if [ "$#" -ne 5 ]; then
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

GITLAB_STATE="$1"
BUILD_ID="$2"
SHA="$3"
BUILD_STAGE="$4"
REPOSITORY="$5"

# Determine GitHub state
if [ "${GITLAB_STATE}" = "created" ] || [ "${GITLAB_STATE}" = "running" ] || [ "${GITLAB_STATE}" = "pending" ]; then
    GITHUB_STATE="pending"
elif [ "${GITLAB_STATE}" = "success" ]; then
    GITHUB_STATE="success"
elif [ "${GITLAB_STATE}" = "failed" ]; then
    GITHUB_STATE="failure"
else
    echo "Unknown GitLab state: ${GITLAB_STATE}"
    exit 1
fi

BUILD_URL="${GITLAB_HOST}"/"${GITLAB_USER}"/"${REPOSITORY}"/builds/"${BUILD_ID}"

PAYLOAD="{\"state\":\"${GITHUB_STATE}\",\"target_url\":\"${BUILD_URL}\",\"context\":\"${BUILD_STAGE}\"}"

curl --verbose -d "$PAYLOAD" -u "${GITHUB_USER}":"${GITHUB_TOKEN}" https://api.github.com/repos/${GITHUB_REPO_OWNER}/${REPOSITORY}/statuses/${SHA}
