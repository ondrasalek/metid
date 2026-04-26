# Security Policy

## Supported versions

Only the **latest released version** of Metid is supported. Older versions
will not receive security fixes; if you find an issue in an older release,
please reproduce it on the current release before reporting.

| Version | Supported |
|---|---|
| Latest release | Yes |
| Anything older | No |

## Threat model

Metid is a 100% offline desktop application. It performs no network requests,
exposes no local services, accepts no inbound connections, and stores no
credentials. As a result, the meaningful attack surface is narrow but real:

### Primary attack vectors

1. **Malicious file content exploiting a bundled sidecar.**
   ExifTool and mkvpropedit are large, mature C/Perl codebases that parse
   complex container formats (TIFF, MP4, MKV, JPEG, etc.). Both have had
   parser-level vulnerabilities in the past, including remote-code-execution
   bugs reachable via crafted files (e.g. CVE-2021-22204 in ExifTool). A
   user who opens an attacker-supplied file in Metid is, in effect, feeding
   that file to those tools.

2. **Malicious file paths.**
   The Rust backend builds command-line invocations of the sidecars from
   file paths chosen by the user. Path injection is mitigated because we
   use `std::process::Command::new(...).args(...)` with no shell
   interpretation, validate tag names against a strict character set
   (`[A-Za-z0-9:_-]`), and reject newlines in tag values. A
   newly-discovered way to escape these protections would be a security
   issue.

3. **Tampered application bundle.**
   If an attacker can replace the bundled `mkvpropedit`, `exiftool`, or any
   of the dylibs inside `Metid.app/Contents/Resources/`, they can run code
   inside the Metid process. This is mitigated by macOS code-signing and
   the hardened runtime, plus a `disable-library-validation` entitlement
   that is intentionally narrow (it allows only ad-hoc-signed dylibs we
   ship ourselves, not arbitrary code).

### Out of scope

The following are not in our threat model and **will not be treated as
security issues**:

- Bugs reachable only by a user supplying their own file paths via the
  command line (e.g. running `metid` directly with hand-crafted args).
- Performance issues, resource exhaustion from very large files, or other
  denial-of-service against the same user who opened the file.
- Issues in third-party tools (ExifTool, mkvpropedit) themselves —
  upstream those reports to the respective maintainers. We will pull
  newer versions into Metid promptly once they are released.
- Behaviour caused by macOS having insufficient TCC permissions granted
  (these are documented in [README.md](README.md#permissions-macos) and
  are not vulnerabilities).

## Reporting a vulnerability

> **Please do _not_ open public GitHub issues for severe vulnerabilities** —
> arbitrary-code-execution, sandbox-escape, or anything else where public
> disclosure before a fix would put users at risk.

Use one of the following private channels instead:

1. **GitHub Security Advisories.** From the repository home page, choose
   _Security_ → _Report a vulnerability_. This opens a private discussion
   visible only to repository maintainers.
2. **Email.** If a private contact email is published in the project's
   README or release notes, you may use that.

When reporting, please include:

- A clear description of the issue and its impact.
- Reproduction steps, ideally with a minimal example file (small, redacted
  if necessary).
- The exact Metid version (`Metid → About`) and macOS version.
- Whether you have already disclosed the issue to anyone else.

We will acknowledge receipt within a reasonable timeframe, work with you on
a fix, and credit you in the release notes if you wish.

## Disclosure timeline

For confirmed vulnerabilities we aim for:

- Initial response: within a few days.
- Fix or mitigation in a release: as soon as practical given the severity.
- Coordinated public disclosure: at the time of the patch release, unless
  agreed otherwise with the reporter.

For low-severity issues that don't require coordinated disclosure, please
just open a normal issue or pull request.

## Defence-in-depth measures already in place

For context, here are the current mitigations Metid relies on:

- **No shell invocation.** All sidecar invocations use `Command::new(...).args(...)`
  with explicit argument arrays — no shell metacharacter interpretation.
- **Path canonicalization.** File paths are resolved to canonical absolute
  form (`std::path::Path::canonicalize`) before being passed to sidecars.
- **Tag-name allowlisting.** Tag names are validated against
  `[A-Za-z0-9:_-]{1,128}` before reaching ExifTool's argfile.
- **Newline rejection in tag values** to prevent ExifTool argfile injection.
- **Pre-flight `O_RDWR` open** before each save, surfacing OS-level errnos
  so we don't silently invoke a sidecar against an unwritable file.
- **Hardened runtime** with library validation explicitly disabled only for
  the ad-hoc-signed mkvpropedit dylibs we bundle ourselves.
- **No sandbox-escape surface.** The app is non-sandboxed by design (file
  manipulation is its purpose), so there is nothing to escape from. TCC
  remains the access-control boundary.
