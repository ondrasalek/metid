# Metid

A blazing-fast, universal metadata editor for macOS — built native, runs offline.

![macOS](https://img.shields.io/badge/macOS-13%2B-black?logo=apple&logoColor=white)
![Tauri](https://img.shields.io/badge/Tauri-v2-24C8DB?logo=tauri&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-stable-orange?logo=rust&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![License](https://img.shields.io/badge/license-MIT-blue)

Metid lets you inspect and edit metadata across nearly every file format on your Mac:
images (JPEG, PNG, RAW), videos (MP4, MOV, MKV, WebM), audio (MP3, FLAC, M4A),
documents (PDF, DOCX, EPUB), and more. It pairs ExifTool's universal format coverage
with mkvpropedit's instant in-place editing for Matroska containers, all behind a
clean macOS-native UI.

## Features

- **Universal format support.** One app for every file type. ExifTool handles the
  long tail; mkvpropedit handles MKV/WebM at near-zero cost (no full re-mux, just a
  few bytes patched in the container header).
- **Smart UI gating.** Plain-text formats (`.txt`, `.md`, `.rtf`) are presented as
  read-only by design — they have no internal metadata container, so the UI explains
  why instead of failing on save.
- **Batch editing with regex extraction.** Apply changes across hundreds of files.
  Variable substitution lets you pull patterns out of filenames — e.g. extract
  `S05E01` and use it as the title for every episode in a season.
- **Format-aware tag suggestions.** Adding a tag to an MP3 surfaces Album / Genre /
  Year; adding to a JPEG surfaces Artist / Copyright / Rating. Universal tags
  (Title, Description) appear for every format.
- **Premium native UI.** Translucent "Deep Glass" sidebar with
  `backdrop-saturate-[180%]`, native macOS overlay titlebar, frosted-pill nav.
- **Robust permission handling.** Pre-flight `O_RDWR` checks surface clear errors
  before any tool runs; macOS TCC entitlements and Info.plist usage descriptions are
  wired for network and removable volumes; failed pre-flights log extended
  attributes for diagnostics without modifying anything.
- **100% offline, zero telemetry.** No analytics, no crash reports, no update
  checks, no network calls of any kind. See the [Privacy Policy](PRIVACY_POLICY.md).

## Requirements

- **macOS 13.0 (Ventura) or later**
- Apple Silicon (Intel build is untested at the moment)
- Homebrew with `mkvtoolnix` and `exiftool` installed for development
  (`brew install mkvtoolnix exiftool`)

## Installation

Download the latest `.dmg` from [Releases](../../releases) and drag Metid into
`/Applications/`. On first launch, macOS may prompt for access to your Desktop /
Documents / Downloads or to network/removable volumes — see the
[Permissions](#permissions-macos) section below.

## Development

```bash
git clone <repo-url>
cd metid
npm install
npm run tauri dev
```

The dev shell launches Vite for the frontend and `cargo run` for the Rust backend.
Hot-reload works for both layers.

## Building

```bash
npm run tauri build
# Output: src-tauri/target/release/bundle/macos/metid.app
```

The build pipeline (`scripts/bundle-mkvpropedit.sh`) bundles `mkvpropedit` plus all
of its Homebrew dylib dependencies into `Contents/Resources/mkvpropedit-libs/`,
rewrites every load path to `@executable_path/`-relative form, and re-signs the
result ad-hoc so macOS doesn't reject the modified Mach-O headers.

After building, sanity-check the bundle:

```bash
zsh scripts/verify-bundle.sh
```

This script prints the bundle ID, code-signature summary, all entitlements baked
into the signed binary, and which TCC usage description strings made it into
`Info.plist` — the strings macOS shows in permission prompts. Without them,
permission denials are silent.

## Permissions (macOS)

> **Read this section if you see "Permission Denied" / `os error 13`.**

Metid edits files in-place. macOS enforces several layers of file-access permission
that don't always show a prompt — they can deny access silently. To save metadata
to files in protected locations, you must explicitly grant access.

### Files on `/Volumes/` — network shares, USB/Thunderbolt, SD cards

1. Open **System Settings** → **Privacy & Security** → **Files and Folders**.
2. Find Metid in the list and enable:
   - **Network Volumes** — for SMB / AFP / NFS shares (NAS, file servers).
   - **Removable Volumes** — for USB drives, SD cards, Thunderbolt enclosures.
3. If those toggles aren't visible for Metid, grant
   **Full Disk Access** instead: System Settings → **Privacy & Security** →
   **Full Disk Access** → add `Metid.app`.
4. Quit and relaunch Metid for the new grant to take effect.

### Stale TCC entries after a rebuild

If you rebuilt Metid from source and saves still fail despite Full Disk Access being
granted, macOS may have a cached TCC entry tied to the previous code signature.
Clear it and try again:

```bash
tccutil reset All dev.metid.desktop
```

### Locked / immutable files

Files marked with the macOS "Locked" attribute (Finder → File → Get Info → Locked)
or with the BSD `uchg` immutable flag cannot be modified by anything until cleared:

```bash
chflags nouchg path/to/file.mkv
# or in Finder: ⌘I and uncheck "Locked"
```

### Read-only volumes

NTFS volumes mounted natively on macOS are read-only. Use a third-party
read/write driver (macFUSE + NTFS-3G, Microsoft NTFS for Mac, Paragon NTFS, etc.)
or copy files to a writable volume first.

### Diagnosing other failures

When a write pre-flight fails, Metid logs all extended attributes for the file to
stderr with a `[metid xattr-diag]` prefix. View with:

```bash
log stream --process metid       # for the bundled .app
# or watch the terminal where `npm run tauri dev` is running in dev
```

This surfaces flags like `com.apple.quarantine` or `com.apple.rootless` so you can
see what's actually involved without modifying the file.

## File format support

| Family | Examples | Writer |
|---|---|---|
| Matroska | `.mkv`, `.webm` | mkvpropedit (in-place, fast) |
| Photos | `.jpg`, `.png`, `.tiff`, `.heic`, `.webp`, `.gif`, `.bmp` | ExifTool |
| Photo RAW | `.cr2`, `.cr3`, `.nef`, `.arw`, `.dng`, `.raf`, `.orf`, `.pef`, `.rw2`, `.x3f`, … | ExifTool |
| Video (non-Matroska) | `.mp4`, `.mov`, `.avi`, `.m4v`, `.mpg`, `.mpeg`, `.flv`, `.3gp` | ExifTool |
| Audio | `.mp3`, `.flac`, `.wav`, `.m4a`, `.aac`, `.ogg`, `.opus`, `.wma`, `.aiff` | ExifTool |
| Documents | `.pdf`, `.docx`, `.xlsx`, `.pptx`, `.epub` | ExifTool |
| Plain text | `.txt`, `.md`, `.rtf` | (read-only — no metadata container exists) |

## Architecture

- **Frontend** — React + TypeScript + Tailwind CSS, bundled by Vite.
- **Backend** — Rust via Tauri v2. Path validation, format routing, and process
  orchestration live here; the actual metadata work is delegated to sidecar tools.
- **Sidecars** — `exiftool` (Perl, distributed with its `lib/` tree as a Tauri
  resource) and `mkvpropedit` (statically resolved to a self-contained dylib bundle
  rebased to `@executable_path/`).
- **Persistent state** — settings only, in
  `~/Library/Application Support/dev.metid.desktop/`. No file index, no caches.

## Privacy

Metid runs 100% locally. No analytics, no crash reports, no update checks, no
accounts, no network calls of any kind. The only files that leave your machine are
the ones you intentionally move yourself. See [PRIVACY_POLICY.md](PRIVACY_POLICY.md)
for the formal statement.

## 🤝 Contributing

Metid is completely **free to use** and open-source. Contributions are what make the open-source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

If you have a suggestion that would make this better, please fork the repo and create a pull request. You can also simply open an issue with the tag "enhancement".

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

For security-sensitive reports, please follow the private disclosure process in [SECURITY.md](SECURITY.md) instead of opening a public issue.

## 🙏 Acknowledgments
This project was brought to life with the architectural guidance, debugging support, and pair-programming assistance of **Google Gemini** and **Anthropic Claude**.

## License

[MIT](LICENSE) © 2026 Ondrej Salek

## ⚖️ Third-Party Licenses

Metid is released under the MIT License. However, it bundles and acts as a GUI wrapper for two incredible open-source CLI tools. We are deeply grateful to their authors:

* **[ExifTool](https://exiftool.org/)** by Phil Harvey. Available under the GNU GPL / Artistic License.
* **[MKVToolNix (mkvpropedit)](https://mkvtoolnix.download/)** by Moritz Bunkus. Available under the GNU GPL v2.

*Note: Metid executes these tools as separate background processes (sidecars). The Metid source code itself remains MIT-licensed, but the bundled binaries remain subject to their respective GPL licenses. You can find their source code at the links provided above.*
