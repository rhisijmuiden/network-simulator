# Updates and channels

[Nederlands](updates.nl.md)

## Channels

| Channel | Branch | For |
| --- | --- | --- |
| Production | `production` | Normal use |
| Test | `test` | Trying the next release before it reaches production |

The **Info** button (top bar) shows the installed version, commit, build date
and channel. Administrators can check for updates there, or on
**Administration > Updates**.

## Updating from the web interface

1. Choose a channel and press **Check for updates**. The server asks GitHub for
   the newest commit on that branch and its version.
2. Press **Update now** (or **Switch to Test/Production** for another channel)
   and confirm.
3. The web server writes a small request file with only the branch and the commit
   id. The systemd path unit starts `network-simulator-update` as root, which:
   - fetches both branches and checks that the commit is on the chosen branch,
   - builds the new release next to the running one (the site stays up),
   - makes a database dump in `/var/lib/network-simulator-update/backups`,
   - stops the server, runs the migrations, switches `current`, starts again,
   - waits until `/healthz` reports the new commit.
4. If the new version does not come up, the previous release and the database
   dump are put back automatically. The status shows *Rolled back*.

The page reloads by itself when the update is done.

## Switching back from test to production

Production may be older than test. Database migrations are forward-only, so
data changes made by the test version stay. If production does not start on
that database, the updater restores the dump it made just before the switch.

## Private repository

The update check uses the GitHub API and the updater uses git. For a private
repository both need `NETSIM_UPDATE_TOKEN` in `/etc/network-simulator/server.env`
(fine-grained token, read-only *Contents*). Restart the service after changing it.

## Releasing (for developers)

1. Feature branch, pull request into `test`. Servers on the test channel can
   install it right after the merge.
2. When `test` is good: bump `version` in `package.json`, merge `test` into `production`.
