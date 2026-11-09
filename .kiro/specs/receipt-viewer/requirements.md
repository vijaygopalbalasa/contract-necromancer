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
2. WHEN the copyable command is pasted into a POSIX shell (sh, bash or zsh) on a machine with Git and Node.js 24 but no global `necro` install THE SYSTEM SHALL make it run to the verify result, for example by defining `necro` inside the command, and it SHALL change nothing outside the folder it clones.
3. WHEN the copyable command runs `necro verify` THE SYSTEM SHALL take the verifier from the repository `vijaygopalbalasa/contract-necromancer` at a fixed commit named in the command, never from the repository being verified, so a project cannot ship its own verifier that always says CONFIRMED; and the page SHALL say next to the command that verifying runs the project's own contracts, which is code from that repository, so a reviewer should run it only for a repository they are willing to run.

## Requirement 6: Design
**User story:** As a visitor, I want the page to feel like Kiroween without getting in the way of the facts.
### Acceptance criteria
1. WHEN the page loads THE SYSTEM SHALL use a dark theme with readable contrast (WCAG AA), a passing contract shown as alive and a failing one as a gravestone, and work at phone width without horizontal scrolling.
2. WHEN a user opens the page with no receipt THE SYSTEM SHALL offer a sample receipt from this repository.

## Requirement 7: Read cleanly
**User story:** As a reviewer, I want the receipt to read cleanly, so that nothing distracts from the facts.
### Acceptance criteria
1. WHEN the task line is shown THE SYSTEM SHALL show it without Markdown emphasis markers (`**`, `__`, backticks).
2. WHEN contracts are grouped by requirement THE SYSTEM SHALL order requirements and the contracts inside each one by criterion number (`R1.2` before `R1.10`).
3. WHEN a passing contract was not required THE SYSTEM SHALL label it "not required for this task", and WHEN a failing contract was not required THE SYSTEM SHALL label it "not built yet".
4. WHEN the page offers the sample or the re-run command THE SYSTEM SHALL use the repository `vijaygopalbalasa/contract-necromancer`, and the README SHALL give the page address `https://vijaygopalbalasa.github.io/contract-necromancer/`.

## Requirement 8: Kiroween look
**User story:** As a judge opening the page, I want it to feel like a resurrection, so that the idea sticks.
### Acceptance criteria
1. WHEN a receipt is shown THE SYSTEM SHALL show a verdict banner first: "Risen" with the count of living contracts when every required contract passes, and "Still buried" with the count of failing required contracts otherwise.
2. WHEN the page loads THE SYSTEM SHALL show an inline SVG mark (a gravestone with a checkmark) drawn in the page itself, with no external images or fonts, and keep text contrast at WCAG AA.
3. WHEN the page animates (a drifting fog layer or a contract rising) THE SYSTEM SHALL turn every animation off under `prefers-reduced-motion: reduce`.
4. WHEN a contract fails THE SYSTEM SHALL draw its row as a gravestone shape, and WHEN it passes THE SYSTEM SHALL draw it as alive, using CSS only, so the page still reads as plain text to a screen reader.

## Requirement 9: First visit
**User story:** As a judge or a reviewer opening the page for the first time, I want to see a real receipt at once, both a risen one and a buried one, so that I understand the tool without reading instructions.
### Acceptance criteria
1. WHEN the page loads with no `?receipt=` and nothing pasted THE SYSTEM SHALL show the bundled sample receipt at once, without a click, and say it is a sample.
2. WHEN the page offers samples THE SYSTEM SHALL offer two from this repository: a risen one (every required contract passes) and a buried one (a real receipt with failing required contracts, written by `necro check` on a spec with a planted bug), and switching between them SHALL need one click.
3. WHEN a receipt is shown after a user action (load, paste, pick, sample switch) THE SYSTEM SHALL bring the verdict banner into view, with no scrolling animation under `prefers-reduced-motion: reduce`.
4. WHEN the page is taller than the window THE SYSTEM SHALL draw its background without a visible band or seam at any scroll position.
5. WHEN the sample is shown on a first visit THE SYSTEM SHALL show the verdict banner and the first contract rows without scrolling in a 1280x800 window and in a 390x844 phone window, with the way to open your own receipt still reachable on the same page (for example a compact bar above the result, or the open-a-receipt card below it).

## Requirement 10: The story in one glance
**User story:** As a judge who lands on the page from the submission, I want to know in ten seconds what the tool does and how to try it, so that the receipt makes sense and I can run the demo myself.
### Acceptance criteria
1. WHEN the page loads THE SYSTEM SHALL show as the page heading, above the sample bar, one sentence naming the idea (Kiro cannot call a task done until its frozen contracts pass), and SHALL keep the first-visit view within Requirement 9.5 and its frozen contract as written.
2. WHEN the page loads THE SYSTEM SHALL show, directly after the receipt card in reading order, a short "How it works" section with three numbered steps (a person freezes the spec's contracts; the gate refuses the tick until they pass; every passing task leaves a receipt anyone can re-run) and the command `npx -y github:vijaygopalbalasa/contract-necromancer demo` in a code block with a copy button, with one line saying it needs Node.js 24 and git and shows the gate refuse a planted bug, accept the fix and re-check the receipt.
3. WHEN the page loads THE SYSTEM SHALL show plain links to the demo video (`https://youtu.be/TYrSyhIYqlk`) and the repository in that section, readable without JavaScript, and SHALL keep the Content Security Policy unchanged (no embedded video, no external script, style, font or image).
4. THE SYSTEM SHALL keep the page title starting with "Contract Necromancer", keep the DOM order the same as the visual order, and work at phone width without horizontal scrolling.
