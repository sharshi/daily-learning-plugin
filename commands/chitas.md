---
description: Print today's Chitas (Chumash + Rashi, Tehillim, Tanya), Rambam, Hayom Yom with text. Args pass through, e.g. "/chitas --refs", "/chitas --after-sunset", "/chitas --full".
allowed-tools: Bash(python3 ${CLAUDE_PLUGIN_ROOT}/scripts/chitas.py:*)
---

Run `python3 ${CLAUDE_PLUGIN_ROOT}/scripts/chitas.py $ARGUMENTS` and print the output verbatim in a code block. Don't paraphrase the Torah text.

If the user asked a question about the Rashi or any section rather than just for the text, run it with `--json` as well and answer from the fetched text, quoting the lines you comment on.

If the output lists issues for a section, say so in one line and give that section's chabad.org link.
