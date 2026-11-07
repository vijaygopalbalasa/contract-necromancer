# Live test of the necro MCP server in Kiro CLI (Nov 8 2026)
Throwaway copy of examples/pumpkin-ledger with .kiro/settings/mcp.json starting `node <repo>/bin/necro.js mcp`, task 4 unticked.
Command: kiro-cli chat --v3 --no-interactive --trust-all-tools --trust-workspace "Using the necro MCP server's necro_status tool, tell me which contracts task 4 of the ledger spec needs and whether each passes right now. Do not change any file."

[tool] status: Completed
[tool] @necro/necro_status
[tool] status: Completed
Task 4 ("Split one expense to the cent (Req 2.1)") is not ticked. Ticking it requires 17 contracts, and all 17 pass right now:

**Property contracts (`properties.contract.test.js`)**
- R5.1 shares of every expense sum to its amount and differ by at most one cent: pass
- R5.2 balances are paid minus shares and sum to exactly zero: pass
- R5.3 settling zeroes every balance with positive whole-cent payments, at most one fewer than people owing or owed: pass
- R5.4 reading the same file twice, or its lines in another order, gives the same balances: pass
- R5.5 a failing property reports the seed and the smallest failing party so it can be replayed: pass

**Read contracts (`requirement-1-read.contract.test.js`)**
- R1.1 records payer, whole-cent amount and what for each line: pass
- R1.2 shares a split line among the listed names and other lines among everyone: pass
- R1.3 treats names that differ in case or spaces as one person with the first spelling: pass
- R1.4 stops with the line number and one plain sentence for a bad line: pass
- R1.5 skips empty lines and lines that start with #: pass

**Split contracts (`requirement-2-split.contract.test.js`)**
- R2.1 gives each sharer the floor and the extra cents to the first names alphabetically: pass
- R2.2 makes balances paid minus shares and sums them to exactly zero: pass

**Settle contracts (`requirement-3-settle.contract.test.js`)**
- R3.1 produces positive whole-cent payments that bring every balance to zero: pass
- R3.2 pays from the biggest debtor to the biggest creditor, ties by name, same every run: pass
- R3.3 prints All square. and no payments when every balance is zero: pass

**CLI contracts (`requirement-4-cli.contract.test.js`)**
- R4.1 prints the balances table then one pays line per payment with two decimals: pass
- R4.2 prints balances and payments as JSON with amounts in integer cents: pass
- R4.3 exits 1 with one plain sentence when the file is missing or unreadable: pass

Since every contract passes, nothing blocks ticking task 4 on the contract side. I changed no files.
