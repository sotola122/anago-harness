# Changelogs

One file per Anago release: `CHANGELOG-v<anagoVersion>.md`, matching the `anagoVersion` in
[`ANAGO_RELEASE.json`](../ANAGO_RELEASE.json) and the `releases/anago-v<anagoVersion>` branch.

Write the entry in the same commit that bumps `ANAGO_RELEASE.json` and cuts the release branch.
Record what a reader of this fork needs: user-visible behavior, interface and configuration
changes, migration steps for an existing profile, and the upstream base the release was built
from. Group entries under Added / Changed / Fixed / Removed / Migration, and cite the pull
request that landed each one.

`master` may carry unreleased work. The newest changelog therefore describes the newest
release, not necessarily everything on `master`; the next release adds the next file.
