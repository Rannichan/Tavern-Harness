# Contributing to Tavern Harness

Thank you for contributing to Tavern Harness. Contributions of bug fixes, features, documentation improvements, tests, and design feedback are welcome.

## Before You Start

- Search existing [issues](https://github.com/Rannichan/Tavern-Harness/issues) before opening a new one.
- For substantial features or behavior changes, open an issue first to discuss the proposal.
- Never include API keys, exported private data, or other sensitive information in issues, commits, or pull requests.

## Development Setup

**Requirements:** Node.js 18 or later and npm.

```bash
git clone https://github.com/Rannichan/Tavern-Harness.git
cd Tavern-Harness
npm install
npm run dev
```

The development server defaults to port 5173 and selects another available port when necessary.

## Branch and Pull Request Workflow

`main` is the stable branch. Do not push directly to it.

1. Create a branch from the latest `main` using a descriptive name, such as `fix/provider-timeout` or `feat/game-export`.
2. Keep each pull request focused on one change.
3. Run the relevant checks locally.
4. Open a pull request against `main` and describe the change clearly.
5. Address review feedback and keep the branch up to date when requested.

Pull requests should include:

- A concise summary of the problem and solution.
- Steps used to test the change.
- Screenshots or recordings for visible UI changes.
- Linked issues where applicable, for example `Closes #123`.

Maintainers may request changes before merging. Please do not merge your own pull request unless you have been explicitly granted permission.

## Checks

Run the relevant commands before submitting a pull request:

```bash
npm run build
npm run test:command-service
npm run test:yolo-mode
```

`npm run build` type-checks the project and creates a production build. Add or update tests when changing behavior covered by the existing test suites.

## Code Guidelines

- Follow the principle of minimal change: make the smallest complete change that solves the stated problem, preserves existing behavior, and avoids unnecessary dependencies, abstractions, configuration, or scope expansion.
- Keep changes small, readable, and consistent with surrounding code.
- Avoid unrelated refactors in the same pull request.
- Use clear names and comments only where the intent is not obvious.
- Preserve the existing UI's visual language. New or changed screens must match the established layout, spacing, typography, colors, controls, responsive behavior, and interaction patterns; do not introduce a distinct visual style without prior discussion.
- Treat the existing UI and its shared styles as the source of truth. Reuse existing components, styles, design tokens, and assets where possible instead of creating parallel UI patterns.
- For visible UI changes, screenshots or recordings and checks at relevant desktop and mobile viewport sizes are recommended.
- Preserve local-first behavior: user data and API keys must remain in browser storage and must not be logged or uploaded unintentionally.
- Sanitize or validate untrusted input appropriately, especially when it reaches rendered HTML, network requests, or tool execution.

## Documentation

- Keep [README.md](README.md) and [README.zh.md](README.zh.md) concise and focused on users: installation, startup, configuration, core features, and common commands.
- Keep the English and Chinese READMEs consistent when changing shared user-facing content.
- Put detailed implementation, architecture, and API documentation in [docs/](docs/), then link to it from the READMEs when appropriate.

## Reporting Bugs

Open an issue with:

- A clear description of the expected and actual behavior.
- Reproduction steps.
- Browser and operating-system version.
- Relevant console errors or exported non-sensitive data.

Remove API keys, tokens, personal information, and private conversation content before sharing logs or exports.

## License

By contributing, you agree that your contributions are licensed under the repository's [MIT License](LICENSE).
