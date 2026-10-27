# testid-scan

Tools that tell you which elements of your Angular, React or Vue app a UI test can find by role and accessible name,
which ones need a test ID, and whether the recommended locators really find the right element.

| Package | What it does | Status |
|---|---|---|
| [`testid-scan`](packages/testid-scan) | Reads your source (Angular templates, React components, Vue single-file components) and reports, element by element, the Playwright locator that finds it, or what it needs first. No build, no browser. | 1.0 |
| [`testid-scan-page`](packages/testid-scan-page) | Opens pages in a real browser and checks each element there; with `--verify`, runs testid-scan's locators on the running app and says, only on evidence, whether each one is verified correct, verified incorrect, or could not be verified. | beta |
| [`testid-scan-bdd`](packages/testid-scan-bdd) | Turns a testid-scan-page scan into Gherkin: a catalog of the steps you can write on each page and step definitions for playwright-bdd that find each element the way the scan did. No source code needed. | beta |

```bash
npx testid-scan src --json scan.json                                  # what the source says
npx testid-scan-page http://localhost:4200/ --verify scan.json         # what the running app says
npx testid-scan-page http://localhost:4200/ --json page.json && npx testid-scan-bdd page.json   # BDD steps for it
```

The packages are independent: each reads the other's JSON output, not its code, and each is
installed, versioned and released on its own. See each package's README for options, limits and how accurate it is.

## Repository

```
packages/testid-scan/        static scanner
packages/testid-scan-page/   page scanner and verifier
  accuracy/                  corpora with known traps, real-app referee runs, labelling kit and scorer
packages/testid-scan-bdd/    Gherkin steps from a page scan
.github/workflows/ci.yml     builds and tests all three, and checks the scanners' accuracy together
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Releases: [RELEASING.md](RELEASING.md).

## License

[MIT](LICENSE)
