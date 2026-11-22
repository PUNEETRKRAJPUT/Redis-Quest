# Security

## What this project is, from a security point of view

Redis Quest runs on one person's Mac. Everything is started with Docker Compose on that machine, nothing is
hosted, and the game does not call out to any service of its own.

- **No secrets.** There are no API keys, tokens or real credentials in the repository. The Redis and Postgres
  passwords in `docker-compose.yml` and `.env.example` are local, throwaway values for containers that only
  your machine can reach.
- **Ports are bound to `127.0.0.1`.** The proxy, Redis, Postgres, the replica, the sentinels, the cluster nodes
  and Redis Insight listen on the loopback address only, so other machines on your network cannot reach them.
- **No Docker socket** is mounted into any container, and the engine never controls Docker.
- **Your own code runs on your own machine.** The code a learner writes is run by the `runner` service in a
  separate Node process with a time limit, and by the `app` service. It is not a sandbox against hostile code.
  Do not paste in code you do not trust, and do not expose the game's port to a network.
- The game stores your progress in `.progress/` and logs in `logs/` inside the repository folder. Nothing is
  sent anywhere.

## What counts as a security problem

Things worth reporting:

- a way for a web page you visit, or another machine, to reach the game's services or read or change your save;
- a way for a level, a workspace file or a pull request to run something outside the containers it is meant to
  run in, or to read files outside the repository folder;
- a secret, token or personal detail committed to the repository or its history;
- a script in `scripts/` or a workflow in `.github/` that can be made to run attacker-chosen commands, for
  example through a pull request from a fork.

Things that are not: the throwaway local passwords above, the fact that a learner's own code can do anything
Node can do on their machine, and a denial of service by running a heavy level on a small machine.

## How to report

Please do not put exploit details in a public issue.

1. If this repository shows a "Report a vulnerability" button under its Security tab, use it. That sends the
   report privately to the maintainer.
2. If there is no such button, open a public issue titled "security: please contact me" with no details. The
   maintainer will reply and set up a private way to send them.

Say what you found, the steps to reproduce it, which commit or tag you tested, and what you think the impact is.
This is a one-person project with no budget for rewards and no service-level promise, but a clear report will
be read and answered, and you will be credited in the fix if you want to be.

## Supported versions

Only the current `main` branch and the latest release tag get fixes.
