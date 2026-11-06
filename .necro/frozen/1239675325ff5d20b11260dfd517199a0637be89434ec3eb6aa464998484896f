# Requirements: receipt-viewer

## Introduction
A static web page (no server, no build step, no dependencies) in `site/`, published on GitHub Pages, where anyone can open a
Contract Necromancer receipt, see which acceptance criteria passed, and check the receipt themselves in the browser.
Honest limit shown on the page: contracts re-run in Node with `necro verify`; the browser checks hashes, not test runs.

## Requirement 1: Open a receipt
**User story:** As a reviewer, I want to open a receipt quickly, so that I can check a task someone claims is done.
### Acceptance criteria
1. WHEN a user pastes receipt JSON or picks a receipt file THE SYSTEM SHALL show the receipt.
2. WHEN the page URL has `?receipt=<url>` pointing to a raw GitHub file THE SYSTEM SHALL fetch and show that receipt.
3. IF the input is not valid receipt JSON THEN THE SYSTEM SHALL say what is wrong in one plain sentence.

## Requirement 2: Show the result
**User story:** As a reviewer, I want each criterion's result at a glance, so that I see what "done" was based on.
### Acceptance criteria
1. WHEN a receipt is shown THE SYSTEM SHALL list every contract by name with pass or fail, the spec name, the git commit and the receipt hash.
2. WHEN a contract name starts with a requirement number like `R1.2` THE SYSTEM SHALL group contracts by requirement.
3. WHEN a receipt has `task` and `required` THE SYSTEM SHALL show the task line and mark each contract as required or not yet required, and show a failing contract that was not required as not built yet rather than as a broken promise.

## Requirement 3: Check the receipt hash in the browser
**User story:** As a reviewer, I want to know the receipt was not edited, so that I can trust what I see.
### Acceptance criteria
1. WHEN a receipt is shown THE SYSTEM SHALL recompute its receipt hash with Web Crypto using the same canonical JSON rules as the CLI and show MATCH or ALTERED.
2. WHEN the same receipt is checked by the page and by `necro verify` THE SYSTEM SHALL compute the same receipt hash.

## Requirement 4: Check pinned files against the public repository
**User story:** As a reviewer, I want the page to check the pinned files, so that I know the receipt describes real code.
### Acceptance criteria
1. WHEN a user enters a public GitHub repository (owner/name) THE SYSTEM SHALL fetch each pinned file at the receipt's commit from raw.githubusercontent.com, hash it, and mark each file as matching or different.
2. IF the receipt has no git commit THEN THE SYSTEM SHALL say the file check needs a commit.
3. WHEN a pinned file is listed in the receipt's `uncommitted` THE SYSTEM SHALL mark it as not in the commit yet (not as different) and say that committing the work and re-running the gate gives a fully public check.

## Requirement 5: Re-run locally
**User story:** As a reviewer, I want the exact command to re-run the contracts, so that I do not need to trust the page.
### Acceptance criteria
1. WHEN a receipt is shown THE SYSTEM SHALL show a copyable command that clones the repository at the commit and runs `necro verify` on the receipt.

## Requirement 6: Design
**User story:** As a visitor, I want the page to feel like Kiroween without getting in the way of the facts.
### Acceptance criteria
1. WHEN the page loads THE SYSTEM SHALL use a dark theme with readable contrast (WCAG AA), a passing contract shown as alive and a failing one as a gravestone, and work at phone width without horizontal scrolling.
2. WHEN a user opens the page with no receipt THE SYSTEM SHALL offer a sample receipt from this repository.
