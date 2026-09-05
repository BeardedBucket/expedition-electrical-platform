---
description: Create a centrally maintained embeddable builder configurator
---

Work only in the current local branch/worktree. Do not create branches, push commits, or open pull requests.
Create an embed package/API that lets a third-party builder include the centrally hosted configurator using a small script or iframe integration with a builder/source identifier.

Requirements:
- no builder-specific fork required
- builder identifier must not grant privileged access by itself
- origin/source attribution must be visible in diagnostics
- configuration should support builder display name, allowed branding fields, inventory overlay, services, and inquiry destination
- protect against arbitrary redirect injection
- generic fallback if an unknown builder ID is supplied
- document versioning/cache strategy so existing embeds receive compatible stable updates
- include a minimal example HTML page
