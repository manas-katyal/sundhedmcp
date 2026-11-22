# Security

SundhedMCP handles health data. Please report a vulnerability privately with
GitHub's **Report a vulnerability** button on the repository's Security tab,
not in a public issue.

Include what you found, how to reproduce it, and what an attacker could reach.
Never attach real sundhed.dk responses, screenshots of a record, CPR numbers or
MitID details: describe the shape of the data instead.

In scope: anything that lets someone other than the logged-in person read
their record, the saved copy, the OAuth tokens or the admin password; anything
that writes to sundhed.dk; CPR numbers that escape the `[CPR]` mask; and any
part of the saved copy that reaches the database or a log unencrypted.
