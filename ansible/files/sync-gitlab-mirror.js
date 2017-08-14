#!/usr/bin/env node

// This script takes a GitHub webhook payload JSON object as its only argument. 

"use strict";

var https = require('https'),
    qs = require('querystring'),
    url = require('url'),
    fs = require("fs"),
    spawn = require("child_process").spawn;

var GITHUB_PAYLOAD = JSON.parse(process.argv.slice(2));

var BENIGN_ERRORS = [
    "Runner was already enabled for this project",
    "404 Project Not Found"
];

var BUILD_EVENTS_WEBHOOK_URL = process.env.BUILD_EVENTS_WEBHOOK_URL;

var GITLAB_HOST = process.env.GITLAB_HOST || "https://gitlab.com";
var GITLAB_USER = process.env.GITLAB_USER;
var GITLAB_REPO = GITHUB_PAYLOAD.repository.name;

var GITHUB_REF = GITHUB_PAYLOAD.ref ? GITHUB_PAYLOAD.ref.split("/").slice(-1)[0] : "";

var GITHUB_PULL_REQUEST_ID = GITHUB_PAYLOAD.number || "";
var GITHUB_PULL_REQUEST_AUTHOR = GITHUB_PAYLOAD.sender.login;

var CONTRIBUTORS_WHITELIST = null;
if (GITHUB_PULL_REQUEST_AUTHOR) {
    try {
        CONTRIBUTORS_WHITELIST = process.env.CONTRIBUTORS_WHITELIST.split(',');
    } catch (e) {
        console.error("Failed to use the CONTRIBUTORS_WHITELIST environment variable.");
        console.error(e.stack);
        return;
    }

    if (!Array.isArray(CONTRIBUTORS_WHITELIST)) {
        console.error("Aborting. The contributor whitelist is not available as an array.");
        return;
    }

    if (CONTRIBUTORS_WHITELIST.indexOf(GITHUB_PULL_REQUEST_AUTHOR) === -1) {
        console.error("Aborting. Not a trusted contributor.");
        return;
    }
}

var GITHUB_USER = process.env.GITHUB_USER;
var GITHUB_REPO_OWNER = process.env.GITHUB_REPO_OWNER;
var GITHUB_REPO = GITHUB_PAYLOAD.repository.name;

var GITLAB_TOKEN = process.env.GITLAB_TOKEN;

var GITLAB_ENABLE_SHARED_RUNNERS = process.env.GITLAB_ENABLE_SHARED_RUNNERS || false;
var GITLAB_RUNNER_ID = process.env.GITLAB_RUNNER_ID;
var CWD = process.env.CWD || process.cwd();

var GITLAB_USER_AND_REPO = GITLAB_USER + "%2F" + GITLAB_REPO;

function pathExists(path) {
    try {
        fs.statSync(path);
        return true;
    } catch (err) {
        return false;
    }
}

function makeGitlabRequest(path, data) {
    var headers = {
        "PRIVATE-TOKEN": GITLAB_TOKEN
    };

    if (data) {
        data = qs.stringify(data);
        headers['Content-Type'] = 'application/x-www-form-urlencoded';
        headers['Content-Length'] = Buffer.byteLength(data);
    }

    var parsed = url.parse(GITLAB_HOST);
    return new Promise(function (resolve, reject) {
        var request = https.request({
            host: parsed.host,
            port: parsed.port || '443',
            path: "/api/v4/" + path,
            method: data ? 'POST' : 'GET',
            headers: headers
        }, function (res) {
            res.setEncoding("utf8");
            var body = "";
            res.on("data", function (data) {
                body += data;
            }).on("error", function (e) {
                e.res = res;
                reject(e);
            }).on("end", function () {
                try {
                    body = JSON.parse(body)
                } catch (e) { }

                // Let's start panicking here if we get client or server errors, or if the message
                // returned by Gitlab is something other than what we expect.
                if (res.statusCode >= 400 && BENIGN_ERRORS.indexOf(body.message) === -1) {
                    reject(body);
                } else {
                    body.res = res;
                    resolve(body);
                }
            });
        }).on("error", function (e) {
            reject(e);
        });

        // Handle post data
        if (data) {
            request.write(data, "utf8");
        }

        request.end();
    });
}

function doesGitlabProjectExist(repo, account) {
    return makeGitlabRequest("projects/" + account + "%2F" + repo).then(function (data) {
        data = data || {};
        data.projectExists = data.res.statusCode !== 404;
        return data;
    });
}

// Shared runners are being disabled because the ones provided by gitlab.com will not provide
// IDI supported environments
function createGitlabProject(repo, account) {
    return makeGitlabRequest('/projects', {
        name: repo,
        public: "true",
        shared_runners_enabled: GITLAB_ENABLE_SHARED_RUNNERS,
        issues_enabled: "false"
    });
}

function ensureGitlabProjectExists(repo, account) {
    console.log("Checking if " + repo + " project exists...");
    return doesGitlabProjectExist(repo, account).then(function (data) {
        console.log(repo + " project " + (data.projectExists ? "exists" : "doesn't exist."));
        if (data.projectExists) {
            return data;
        }

        console.log("Creating the project...");
        return createGitlabProject(repo, account);
    });
}

function enableGitlabRunner(projectId) {
    return makeGitlabRequest('/projects/' + projectId + '/runners', {
        runner_id: GITLAB_RUNNER_ID
    });
}

function addGitlabBuildEventsHook(projectFullName, webhookUrl) {
    return makeGitlabRequest('projects/' + projectFullName + '/hooks', {
        url: webhookUrl,
        job_events: "true",
        push_events: "false"
    });
}

function git(command, args, opts) {
    opts = opts || {};
    opts.stdio = ["pipe", "pipe", "inherit"];
    return new Promise(function (resolve, reject) {
        var proc = spawn("git", [command].concat(args), opts);
        var output = "";
        proc.stdout.on("data", function (chunk) {
            output += chunk;
        });

        proc.on("error", reject).on("close", function (exitCode) {
            if (exitCode !== 0) {
                console.warn("The git command returned non-zero exit code!");
            }
            resolve(output.trim());
        });
    });
}

function cloneRepo(owner, repo, outputDir) {
    return git("clone", ["https://github.com/" + owner + "/" + repo, outputDir]);
}

function addRemote(name, owner) {
    var dir = getRepoWorkingDirPath(name, owner);
    return git("remote", [
        "add",
        "gitlab",
        "https://" + GITLAB_USER + ":" + GITLAB_TOKEN + "@" + url.parse(GITLAB_HOST).host + "/" + GITLAB_REPO_OWNER + "/" + GITLAB_REPO + ".git"
    ], {
            cwd: dir
        });
}

function getGitlabRemote(name, owner) {
    var dir = getRepoWorkingDirPath(name, owner);
    return new Promise(function (res, rej) {
        // If there's no remote and that causes a failure here, let's resolve with an empty string
        git("remote", [
            "remove",
            "gitlab"
        ], {
                cwd: dir
            }).then(function (url) {
                res(url);
            }).catch(function (e) {
                res("");
            });
    });
}

// Takes git ref arg and pushes to Gitlab remote of repo arg
function pushRef(name, owner, ref) {
    var dir = getRepoWorkingDirPath(name, owner);
    return git("fetch", [
        "origin"
    ], {
            cwd: dir
        }).then(function () {
            return git("push", [
                "gitlab",
                "refs/remotes/origin/" + ref + ":refs/heads/" + ref,
                "--force"
            ], {
                    cwd: dir
                });
        });
}

function pushPullRequestRef(name, owner, id) {
    var dir = getRepoWorkingDirPath(name, owner);
    return git("fetch", [
        "origin",
        "+refs/pull/*:refs/pull/*"
    ], {
            cwd: dir
        }).then(function () {
            return git("push", [
                "gitlab",
                "+refs/pull/" + id + "/head:refs/heads/gh-pr-" + id
            ], {
                    cwd: dir
                });
        });
}

function getRepoWorkingDirPath(name, owner) {
    return CWD + "/" + name + "_" + owner;
}

function ensureRepoWorkingDirExists(name, owner) {
    var dir = getRepoWorkingDirPath(name, owner);
    if (pathExists(dir)) {
        return new Promise(function (res) {
            res(true);
        });
    }
    return cloneRepo(GITHUB_REPO_OWNER, GITHUB_REPO, dir);
}

function ensureRepoRemoteExists(name, owner) {
    return getGitlabRemote(name, owner).then(function (url) {
        return addRemote(name, owner);
    });
}

console.log("Ensuring the project exists...");
ensureGitlabProjectExists(GITLAB_REPO, GITLAB_USER).then(function (data) {
    // Add the CI runner's ID
    console.log("Enabling the CI runner...");
    return enableGitlabRunner(data.id)
}).then(function (data) {
    console.log("Adding build events hook URL...");
    return addGitlabBuildEventsHook(GITLAB_USER_AND_REPO, BUILD_EVENTS_WEBHOOK_URL);
}).then(function (data) {
    console.log("The build events hook was created.");
    console.log("Cloning the repository: " + GITHUB_REPO_OWNER + "/" + GITHUB_REPO);
    return ensureRepoWorkingDirExists(GITHUB_REPO, GITHUB_USER);
}).then(function (data) {
    console.log("The repository exists on the disk.");
    console.log("Making sure the Gitlab remote exists...");
    return ensureRepoRemoteExists(GITHUB_REPO, GITHUB_USER);
}).then(function (data) {
    console.log("Added the Gitlab remote.");
    if (GITHUB_PULL_REQUEST_ID) {
        console.log("Pushing " + GITHUB_PULL_REQUEST_ID + "...");
        return pushPullRequestRef(GITHUB_REPO, GITHUB_USER, GITHUB_PULL_REQUEST_ID);
    }
    console.log("Pushing " + GITHUB_REF + "...");
    return pushRef(GITHUB_REPO, GITHUB_USER, GITHUB_REF);
}).then(function () {
    console.log("Pushed the ref to Gitlab.");
}).catch(function (e) {
    console.error(e.stack || e);
});
