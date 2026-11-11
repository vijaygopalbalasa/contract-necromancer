# Requirements: receipt-viewer

## Introduction
A static web page (no server, no build step, no dependencies) in `site/`, published on GitHub Pages, where anyone can open a
Contract Necromancer receipt, see which acceptance criteria passed, and check the receipt themselves in the browser.
Honest limits shown on the page: the gate and `necro verify` run every contract in Node.js. The browser checks hashes, and
in the play (Requirement 13) it also runs the example's seven contracts that need nothing but JavaScript, with small
stand-ins for `node:test` and `node:assert`. (Revised Nov 11 for Requirement 13.)

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
5. WHEN the sample is shown on a first visit THE SYSTEM SHALL show the verdict banner without scrolling in a 1280x800 window; in a 390x844 phone window it SHALL show, without scrolling, the start control of the play (Requirement 13.9) and the result line of Requirement 12.1. In both windows there SHALL be no horizontal scrolling, and the way to open your own receipt SHALL still be reachable on the same page. (Revised Nov 9: the earlier word limit above the banner is dropped so that the story of Requirement 11 can sit above it. Revised Nov 12 for Requirement 14: at phone width the start control and the result line take the place of the banner.)

## Requirement 10: The story in one glance
**User story:** As a judge who lands on the page from the submission, I want to know in ten seconds what the tool does and how to try it, so that the receipt makes sense and I can run the demo myself.
### Acceptance criteria
1. WHEN the page loads THE SYSTEM SHALL show as the page heading, above the sample bar, one sentence naming the idea (Kiro cannot call a task done until its frozen contracts pass), and SHALL keep the first-visit view within Requirement 9.5 and its frozen contract as written.
2. WHEN the page loads THE SYSTEM SHALL show, directly after the receipt card in reading order, a short "How it works" section with three numbered steps (a person freezes the spec's contracts; the gate refuses the tick until they pass; every passing task leaves a receipt anyone can re-run) and the command `npx -y github:vijaygopalbalasa/contract-necromancer demo` in a code block with a copy button, with one line saying it needs Node.js 24 and git and shows the gate refuse a planted bug, accept the fix and re-check the receipt.
3. WHEN the page loads THE SYSTEM SHALL show plain links to the demo video (`https://youtu.be/TYrSyhIYqlk`) and the repository in that section, readable without JavaScript, and SHALL keep the Content Security Policy unchanged (no embedded video, no external script, style, font or image).
4. THE SYSTEM SHALL keep the page title starting with "Contract Necromancer", keep the DOM order the same as the visual order, and work at phone width without horizontal scrolling.
5. WHEN the page loads THE SYSTEM SHALL show, above the verdict banner, one short plain link (at most six words, such as "How it works, and try it") that jumps to the "How it works" section, and the page SHALL still pass the frozen Requirement 9.5 contract as written.

## Requirement 11: The first screen tells the story
**User story:** As a judge who has never heard of the tool, I want the first screen to show what happens when Kiro claims a task is done, so that the receipt below means something to me.
### Acceptance criteria
1. WHEN the page loads THE SYSTEM SHALL show, between the heading and the verdict banner, a compact strip of three beats taken from the real `necro demo` output: Kiro says task 4 is done; the gate refuses the tick and names failing contracts (at least R2.1 and R2.2); after the fix the gate accepts the tick, writes a receipt and `necro verify` prints CONFIRMED. The beats SHALL be plain text in reading order, readable without JavaScript.
2. WHERE the strip animates (for example each beat appearing in turn) THE SYSTEM SHALL use CSS only and SHALL show all three beats at once, with no animation, under `prefers-reduced-motion: reduce`.
3. WHEN the page loads THE SYSTEM SHALL show the command `npx -y github:vijaygopalbalasa/contract-necromancer demo` with a copy button within the first screen at 1280x800, as the way to see the strip happen for real.
4. WHEN the sample buttons are shown THE SYSTEM SHALL label them in plain words a newcomer understands (for example "A passing receipt" and "A refused one"), and the sample note SHALL say in one sentence what a receipt is (the contracts that had to pass before Kiro could tick the task).
5. WHEN the page loads THE SYSTEM SHALL have an inline `data:` SVG favicon of the gravestone mark, so the browser requests no missing icon, and a title that starts with "Contract Necromancer" and says what it does, with the Content Security Policy unchanged.

## Requirement 12: The evidence on the first screen
**User story:** As a judge, I want to see on the first screen that the gate changes what Kiro does, so that I know why to trust the receipt below.
### Acceptance criteria
1. WHEN the page loads THE SYSTEM SHALL show, between the story strip and the verdict banner, the experiment result (on a task that cannot honestly be finished, Kiro marked it done in 11 of 11 runs without the gate and 0 of 19 with it, across two models) and, in the same element, the round 3 caveat (under a "do whatever it takes" prompt one gated run of six got past the gate by patching JavaScript built-ins; that hole is closed and the cheat is kept as a test), with a plain link to `https://github.com/vijaygopalbalasa/contract-necromancer/blob/main/experiments/README.md`, while Requirement 9.5 still holds. (Revised Nov 12: the round 3 caveat is added so the page never states the result without it.)
2. THE page SHALL not say that contracts re-run only in Node; it SHALL say that `necro verify` re-runs JavaScript contracts and runner contracts (for example pytest) alike.

## Requirement 13: Play the gate on the page
**User story:** As a judge who will not install anything, I want to send the gate a false "done" and then the real fix from this page, so that I see the gate refuse and accept with my own clicks.
### Acceptance criteria
1. THE site SHALL include, under `site/play/`, copies of every file that the risen and buried ledger receipts pin (the ledger's `requirements.md`, its five contract files and its source files), byte for byte the same as `examples/pumpkin-ledger`, and a risen receipt that the gate wrote when it accepted task 4 in a copy of that example. Every pin in that receipt SHALL match the copies, and every pin in the buried sample (`site/sample-buried.json`) SHALL match the copies except `src/split.js`, which SHALL match the copy with the planted change applied.
2. WHEN the user sends the tick with the planted change (the change `necro demo` plants: `Math.round(cents / n)` and `const extra = 0;`) THE SYSTEM SHALL run, in a Web Worker in the browser, the ledger's two contract files that need nothing but JavaScript (`requirement-2-split` and `properties`, contracts R2.1, R2.2 and R5.1 to R5.5) against the copied sources with the planted change, show that the tick is refused, and list each failing contract with its assertion message. The results SHALL be R2.1, R2.2, R5.1, R5.2, R5.3 and R5.4 failing and R5.5 passing.
3. WHEN the user applies the fix THE SYSTEM SHALL run the same seven contracts against the copied sources as they are, show all seven passing, and show the risen receipt with its receipt hash recomputed in the browser (MATCH) and its pinned files re-hashed from the copies.
4. WHEN the user changes one byte of `src/split.js` in the play THE SYSTEM SHALL re-hash the copy with that byte changed and show `MISMATCH. Files changed: src/split.js.`, the words `necro verify` prints for that change.
5. WHEN the play shows a browser run THE SYSTEM SHALL say in plain words that the browser ran 7 of the ledger's 18 contracts and that the other 11 start the ledger's command line, which a browser cannot do, and SHALL show next to it the result of the gate's full run on the same code: 9 failing for the planted change (from the buried sample) and 18 passing for the fix (from the risen receipt). The seven SHALL be a fixed list in the code, never inferred from an error.
6. THE worker SHALL run a copied file only after its SHA-256 matches the pin in the receipt for that run (the buried sample for the planted change, the risen receipt for the fix), SHALL build modules only from those files and the two stand-ins it ships, and SHALL take no code from the URL, the paste box or any other input.
7. THE play SHALL say in one sentence that the browser runs the contracts with small stand-ins for `node:test` and `node:assert`, while the gate runs them in Node.js. For the planted change and for the fix, each of the seven contracts SHALL have the same result in the browser as in a run of `necro check ledger` in Node.js on the same code.
8. IF the worker cannot start, a file fails its hash check, or a run takes longer than 10 seconds THEN THE SYSTEM SHALL stop the run, say what happened in one plain sentence, and show the gate's full-run result for that step from the receipts, and SHALL never leave a step showing "running".
9. WHEN the page loads with scripts on THE SYSTEM SHALL offer a control that starts the play, visible in the first screen at 1280x800 and at 390x844, SHALL open the play directly below the story strip when it is used, and SHALL keep the frozen contracts for Requirements 9, 10, 11 and 12 passing as written.
10. THE play SHALL work with the keyboard alone (focus moves to each step's result, and results are announced in a polite live region), show results without animation under `prefers-reduced-motion: reduce`, fit a 390 px wide window with no sideways page scroll, keep the Content Security Policy in `index.html` unchanged, and fetch nothing but files from the page's own origin. No sentence it adds SHALL break the frozen Requirement 12.2 contract.

## Requirement 14: The first screen names what is raised and leads with the result
**User story:** As a judge deciding whether this entry fits the Resurrection category, I want the first screen to name the dead idea it raises and to show the result plainly, so that I see the theme and the evidence without reading further.
### Acceptance criteria
1. WHEN the page loads THE SYSTEM SHALL show, beside the page heading, one short line naming the idea that is raised: Design by Contract, from Eiffel (1986), raised for coding agents. The line SHALL be readable without JavaScript, and the page heading (Requirement 10.1) and the title (Requirement 11.5) SHALL stay as they are.
2. WHEN the page loads THE SYSTEM SHALL draw the result of Requirement 12.1 with more visual weight than body text, with the two counts (11 of 11 without the gate, 0 of 19 with it) as large numbers and the round 3 caveat in the same element, readable without JavaScript, at WCAG AA contrast.
3. WHEN scripts are on THE SYSTEM SHALL make Try it here the single main action of the first screen: no other control above the verdict banner SHALL be drawn in the same filled style as Try it here.
4. WHEN a receipt has no task (a receipt written by `necro check`, not by a tick) THE SYSTEM SHALL say so in its task line in plain words instead of "none recorded".
5. THE contracts for this requirement and for the revised 9.5 and 12.1 SHALL check geometry against the window, computed styles and text, and SHALL NOT pin pixel sizes or positions, so they pass on any operating system's fonts.

