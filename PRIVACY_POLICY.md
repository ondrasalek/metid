# Privacy Policy

_Last updated: 2026-04-26_

Metid is a desktop application that runs entirely on your Mac. This document
explains what data Metid handles, where it lives, and what leaves your machine.

The short version: **nothing leaves your machine**.

## Summary

- Metid is **100% offline.** It performs no network requests of any kind.
- Metid collects **no telemetry, no analytics, and no crash reports.**
- Metid has **no accounts, no logins, and no cloud sync.**
- Metid does **not** phone home to check for updates, validate licenses, or
  report usage. There is no server-side component.
- All metadata reading and writing happens locally via bundled command-line
  tools (`exiftool` and `mkvpropedit`) running on your own Mac.

## What Metid does on your machine

When you open a file in Metid, the application:

1. Reads the file's existing metadata using a locally-bundled copy of ExifTool
   (or `mkvpropedit` for Matroska containers).
2. Displays that metadata in the UI.
3. When you click Save, writes your edits back to the same file in place using
   the same locally-bundled tools.

This activity is entirely local. No file content, no metadata, no file paths,
and no information about you ever leaves your computer through Metid.

## What Metid stores on your machine

| Data | Location | Purpose |
|---|---|---|
| User preferences (e.g. "keep backups", default batch columns) | `~/Library/Application Support/dev.metid.desktop/` | Remember your settings between launches. |
| Window position and size | macOS standard window-state mechanisms | Standard macOS behavior. |
| Code-bundled tools | Inside `Metid.app/Contents/Resources/` | Running ExifTool and mkvpropedit without a Homebrew dependency. |

Metid does **not** keep a database of files you have opened, an index of your
media library, a history of edits, or any cache of file content. Closing Metid
without saving discards everything except the preferences listed above.

## Files you edit

Metid modifies files **in place** when you save. This is by design — that's the
purpose of the application. The files you choose to edit remain on your local
filesystem (or on the network volume you opened them from). Metid does not
copy, upload, transmit, or share those files in any form.

If `keep_backups` is enabled in settings, ExifTool will preserve a `_original`
copy of each modified file alongside the original — these are also strictly
local and never transmitted anywhere.

## Permissions Metid requests from macOS

Metid asks macOS for permission to access protected file locations (Network
Volumes, Removable Volumes, Desktop, Documents, Downloads). These permissions
are required so that ExifTool and mkvpropedit can read and write files in those
locations on your behalf. The grants are managed by macOS in
**System Settings → Privacy & Security**, and you can revoke them at any time.
Metid does not transmit any data based on these grants — they only allow local
file I/O.

## Third-party components

Metid bundles two command-line tools that run as local subprocesses on your
machine:

- **ExifTool** by Phil Harvey — [exiftool.org](https://exiftool.org/).
  Distributed under the same license as Perl. Runs entirely locally.
- **mkvpropedit** from MKVToolNix by Moritz Bunkus —
  [mkvtoolnix.download](https://mkvtoolnix.download/). Distributed under GPL-2.0.
  Runs entirely locally.

Neither tool makes network requests in the way Metid invokes it.

## Children's privacy

Metid does not collect personal information from anyone, of any age.

## Changes to this policy

If this policy ever changes, the updated version will be published in this
repository. Because Metid does not check for updates, you should re-read this
file when you upgrade to a new release.

## Contact

Questions about this policy can be raised by opening an issue in the project
repository.
