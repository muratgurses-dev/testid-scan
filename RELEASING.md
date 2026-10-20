# Releasing

## Once: set the repository owner

`package.json` of both packages points at `github.com/GITHUB_OWNER/testid-scan`. Replace the placeholder with the
GitHub user that owns the repository, then commit:

```bash
sed -i.bak 's/GITHUB_OWNER/<your-github-user>/g' packages/*/package.json && rm packages/*/package.json.bak
```

## Every release of a package

1. CI is green on `main` (all three jobs).
2. In the package folder: bump `version` in `package.json` and add the section to `CHANGELOG.md`.
   - testid-scan follows semantic versioning from 1.0: new JSON fields or options are a minor version; anything that
     breaks the JSON (`schemaVersion`) or removes an option is a major version.
   - testid-scan-page is in beta (0.x): a minor version may change verdicts, always toward fewer wrong ones.
3. Check what will be published (only `dist`, the README, the license, and testid-scan's example config):

   ```bash
   npm pack --dry-run
   npm run smoke   # installs the packed tarball into an empty folder and runs it
   ```

4. Publish (`prepublishOnly` builds and tests first):

   ```bash
   npm login            # once per machine; an account with two-factor authentication
   npm publish          # publishConfig.access is public
   ```

5. Tag and push: `git tag testid-scan-v1.0.0` (or `testid-scan-page-v0.9.0`), `git push --tags`, and create a GitHub
   release from the CHANGELOG section.

## First release

Publish `testid-scan` 1.0.0 first, then `testid-scan-page` 0.9.0: testid-scan-page's README tells people to run
testid-scan.
