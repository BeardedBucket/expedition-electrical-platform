# Fresh Repository Setup on Windows

This package is intended to become the first commit of a new, empty GitHub repository.

## 1. Extract this folder

Use a short path such as:

`C:\Users\YOURNAME\Documents\GitHub\expedition-electrical-platform`

## 2. Open PowerShell in the extracted folder

Confirm the hidden `.github` directory exists:

```powershell
Get-ChildItem -Force
Get-ChildItem .github -Recurse
```

## 3. Initialize Git

```powershell
git init
git branch -M main
git add .
git status
git commit -m "Initial project architecture"
```

## 4. Attach the new empty GitHub repository

Replace the URL if you choose a different repository name:

```powershell
git remote add origin https://github.com/BeardedBucket/expedition-electrical-platform.git
git push -u origin main
```

## 5. Normal development workflow

Create branches yourself so Copilot does not need repository-management permissions:

```powershell
git switch main
git pull
git switch -c feat/bootstrap
```

Open the folder in VS Code and run the first Copilot prompt. After reviewing changes:

```powershell
git status
git diff
git add .
git diff --staged
git commit -m "Bootstrap configurator workspace"
git push -u origin feat/bootstrap
```

Then open the pull request in GitHub yourself.
