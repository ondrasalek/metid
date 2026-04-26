# Terms of Service

_Last updated: 2026-04-26_

These terms govern your use of Metid (the "Software"), a desktop metadata
editor for macOS distributed under the [MIT License](LICENSE).

## Acceptance

By installing, building, or running Metid you agree to these terms. If you do
not agree, do not use the Software.

## License

Metid is open-source software licensed under the [MIT License](LICENSE). The
license grants you broad rights to use, modify, and redistribute the Software
subject to the conditions stated there. Nothing in this document overrides
the MIT License — these terms are supplementary.

## "As is" — no warranty

> **THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND**, express
> or implied, including but not limited to the warranties of merchantability,
> fitness for a particular purpose, and noninfringement.

In plain language: Metid is a free, open-source tool offered without any
guarantees. It may have bugs. It may not behave correctly on your specific
files, filesystems, or macOS version. Use it at your own risk.

## Back up your files

> **Metid edits files in place. Always back up your media library before
> performing batch operations.**

This is the single most important practical warning. Metid is designed to
modify file metadata in place — that is its purpose. Although the Software has
been built with safety in mind (pre-flight write checks, format-specific
routing, careful path validation), bugs in Metid, in the bundled sidecar tools
(ExifTool, mkvpropedit), in your filesystem, in your network connection (if
working with files on a NAS), or in macOS itself can result in data loss or
corruption.

Specific scenarios where the risk is higher:

- **Batch operations across many files** — a single bug or unexpected input
  can affect hundreds of files before you notice.
- **Files on network volumes (SMB/AFP/NFS)** — interrupted writes mid-save
  can leave a file in an inconsistent state. Verify your network is stable.
- **Files on removable storage** — never disconnect the drive while a save is
  in progress.
- **One-of-a-kind files** — irreplaceable footage, unique scans, original
  masters. Always work on a copy.

The author of Metid is not liable for any data loss, corruption, or damage of
any kind arising from your use of the Software, regardless of the cause.

## Limitation of liability

To the fullest extent permitted by applicable law, in no event shall the
author or copyright holders be liable for any claim, damages, or other
liability — whether direct, indirect, incidental, consequential, special,
exemplary, or punitive — arising from, out of, or in connection with the
Software or your use of it. This includes but is not limited to:

- Loss of, corruption of, or damage to files (media, documents, projects).
- Loss of metadata, including content that cannot be reconstructed.
- Costs of substitute software, services, or recovery efforts.
- Lost time, lost work, or lost revenue.
- Any consequential damages arising from the above.

## Your responsibilities

When you use Metid, you are responsible for:

- Keeping current backups of any files you intend to modify.
- Verifying that your changes are correct after each batch operation.
- Granting Metid only the macOS permissions strictly necessary for your use.
- Ensuring you have the legal right to modify the metadata of any file you
  open in Metid (third-party content may be subject to copyright or licence
  conditions you must respect).
- Keeping the bundled sidecar tools (ExifTool, mkvpropedit) up to date by
  installing newer Metid releases when available.

## Third-party tools

Metid bundles ExifTool and mkvpropedit as local sidecar binaries. These tools
are governed by their own licenses (the same license as Perl for ExifTool;
GPL-2.0 for mkvpropedit). Metid does not modify their behaviour beyond
invoking them with file paths and tag arguments. Bugs, vulnerabilities, or
unexpected behaviour originating in these tools are not the responsibility of
the Metid author.

## Changes to these terms

If these terms ever change, the updated version will be published in this
repository. Continued use after a change constitutes acceptance of the
updated terms.

## Governing law

These terms shall be construed in accordance with general principles of
international software licensing law and the MIT License under which the
Software is distributed. They do not create any contractual relationship
beyond what the MIT License itself establishes.
