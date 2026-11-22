# Backup and restore

[Nederlands](backup.nl.md)

Everything is under **Administration > Backup & restore** (administrators only).

## What a backup contains

- The PostgreSQL database (users, settings, backup locations, history, audit log;
  in later phases topologies and lessons). Active sessions are left out.
- The data folder `/var/lib/network-simulator`, including `secret.key`, which
  encrypts the stored passwords (SMTP, backup locations).

## How it works

- **Full and incremental.** A full backup starts a new *chain*. Incremental
  backups split the data into content-defined chunks and only upload chunks the
  chain does not have yet. Every backup lists all its chunks, so each one
  restores on its own; you never apply a chain by hand.
- **Encrypted before it leaves the server.** Every chunk is compressed (zstd)
  and encrypted with AES-256-GCM. The data key is wrapped with a key derived
  from your passphrase (scrypt). Chunk names are keyed hashes, so the storage
  server learns nothing about the content.
- **Verified on restore.** Every chunk is authenticated, and every file is
  checked against its SHA-256 before anything is changed.
- **Retention.** A new full backup every *N* days; the newest *K* chains are
  kept and older chains are deleted with their incrementals.

Layout at the location: `netsim-backup.json` (wrapped key), `chains/<id>/chunks/`,
`chains/<id>/manifests/`.

## 1. Set the passphrase

Tab **Schedule & encryption**. At least 12 characters. **Store it in your
password manager**: without it nobody can restore the backups. Changing it later
re-wraps the key at every reachable location; existing backups stay readable.

## 2. Add locations

| Type | Use for | Notes |
| --- | --- | --- |
| SCP / SFTP | NAS (Synology, QNAP), Linux server | Password or SSH key (OpenSSH/PEM). Uses the SSH file transfer subsystem, which every SCP server offers. Modern algorithms only (curve25519, AES-GCM, ChaCha20). |
| FTPS | FTP server with TLS | Explicit TLS on 21 or implicit TLS on 990, TLS 1.2 or newer. |
| FTP | Old servers only | The password travels unencrypted; the backup itself is still encrypted. |

Press **Test connection**: the server connects, writes, reads and deletes a test
file and looks for existing backups. The first time it shows the **SSH host key**
or, for a self-signed FTPS certificate, the **certificate fingerprint**. Compare it
with the server and press **Trust**. If the key changes later, backups stop until
you trust it again.

Synology example: Control Panel > File Services > FTP > enable *SFTP*, create a
user `netsim-backup` with access to one shared folder, then add a location of
type SCP / SFTP with port 22 and folder `backup/network-simulator`.

## 3. Schedule

Choose how often (every hour up to daily), from what time, how often a new full
backup starts and how many full backups to keep. A backup missed while the
server was off runs once it is back. When a backup fails, every administrator
with an e-mail address gets a message (set up the mail server first).

**Back up now** makes an incremental backup (or a full one if the location has
none yet); **Full backup** starts a new chain.

## Restore on the same server

1. Tab **Restore**, choose the location and press **Find backups**.
2. Pick a backup, press **Restore this backup** and type `RESTORE`.
3. The server downloads and verifies the backup into a staging folder. Then the
   helper `network-simulator-restore` stops the server, replaces the database
   (in one transaction) and the data folder, runs migrations and starts again.
4. Everyone is signed out. Sign in with an account from the backup.

The previous state is kept in `/var/lib/network-simulator/restore/rollback`
until the next restore, and is put back automatically if the restore fails.
A backup made by a newer version cannot be restored on an older one: update first.

## Restore on a new server

1. Install Network Simulator on a new container (see [install.md](install.md)) and
   sign in with the one-time password.
2. **Backup & restore > Restore**, choose **Another location**, fill in the
   location of the old server and the backup passphrase, press **Find backups**.
3. Restore the newest backup. After the restart, sign in with your old account.
   Locations, passphrase and schedule come back with the backup.
