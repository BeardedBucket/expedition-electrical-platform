# Copilot Workflow

## Recommended proof-of-concept workflow

Use Copilot/Agent locally in VS Code against a normal Git clone. This avoids requiring the GitHub Copilot coding-agent app to create branches or pull requests on your behalf.

1. Clone the repository locally.
2. Create the branch yourself with Git.
3. Open that local folder in VS Code.
4. Give Copilot one prompt file at a time from `.github/prompts/`.
5. Review `git diff` and run tests locally.
6. Commit and push the branch yourself.
7. Open the pull request yourself in GitHub.

The prompts intentionally do not tell Copilot to create branches, push, or open pull requests.

## If using GitHub's hosted coding agent later

Hosted coding agents can require repository/app permissions that are independent of the code in this repository. If the agent reports a branch, push, or pull-request permission failure, do not weaken repository security merely to satisfy the agent. Use the local workflow above or explicitly configure the app permissions after reviewing GitHub's current documentation.
