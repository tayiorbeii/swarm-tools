---
"swarm-mail": patch
"opencode-swarm-plugin": patch
---

Fix swarm-mail package to include dist folder

- Add files field to swarm-mail package.json to explicitly include dist/
- Previous publish was missing build output, causing "Cannot find module" errors
