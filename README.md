# Vibe Coding

One mini project every day. Each folder is a self-contained project built in a
single day, with its own README, source, and usage instructions.

| Day | Project | What it does |
|-----|---------|--------------|
| [01](day-01-port-scanner) | TCP Port Scanner | Scan open TCP ports on a host with a multithreaded Python CLI |
| [02](day-02-log-analyzer) | Log Analyzer | Turn an Apache/Nginx access log into a support dashboard (single-file web app) |
| [03](day-03-ticket-tracker) | Mini Helpdesk | IT support ticket tracker with SLA highlighting, audit trail, CSV/JSON export (single-file web app) |
| [04](day-04-link-checker) | QA Link Checker | CLI that checks URL lists for broken links, follows redirects, times responses, writes JSON/CSV reports (Node.js stdlib only) |
| [05](day-05-password-checker) | Password Strength Checker & Policy Auditor | Grades passwords against corporate password policies, estimates entropy/crack time, generates secure passwords (single-file web app) |
| [06](day-06-backup-helper) | Backup Buddy | Timestamped ZIP backups with rotation, SHA-256 integrity verification, dry-run and exclude patterns (Python CLI, stdlib only) |
| [07](day-07-subnet-calculator) | Subnet Calculator & IP Toolkit | Subnet math, subnet planner, and binary converter for IPv4 networking (single-file web app) |
| [08](day-08-dns-checker) | DNS Health Checker | CLI that audits a domain's DNS records (MX, SPF, DMARC, NS, PTR, wildcard) and flags support-relevant issues, with JSON/CSV reports (Node.js stdlib only) |
| [09](day-09-json-log-viewer) | JSON Log Viewer | Paste minified JSON / NDJSON logs and get a readable, filterable log view: level detection (strings, pino, syslog), timestamp normalisation, expandable JSON tree, live search, copy/download (single-file web app) |
| [10](day-10-data-wrangler) | Data Wrangler | CSV ⇄ JSON converter with auto-format/delimiter detection, RFC-4180 parsing, sortable searchable table preview, copy/download (single-file web app) |
| [11](day-11-uptime-monitor) | Service Uptime Monitor | Continuously polls HTTP(S) services, measures latency, classifies UP/DEGRADED/DOWN, alerts + logs incidents to NDJSON, live terminal dashboard (Node.js CLI, stdlib only) |
| [12](day-12-cert-checker) | Cert Watch | SSL/TLS certificate expiry checker: grades OK/WARNING/CRITICAL/EXPIRED, two-phase verification with DER date parsing, proxy + corporate-CA support, JSON/CSV reports (Python CLI, stdlib only) |
| [13](day-13-dupe-finder) | Dupe Finder | Find duplicate files by content with two-phase size-then-SHA-256 detection, report wasted disk space, safe confirm-first cleanup, JSON/CSV reports (Python CLI, stdlib only) |
| [14](day-14-security-headers) | HTTP Security Header Checker | Audit a website's security headers (HSTS, CSP, clickjacking, cookie flags, info disclosure), grade it A+ to F with plain-language explanations, JSON/CSV reports (Python CLI, stdlib only) |
| [15](day-15-bug-report-builder) | Bug Report Builder | Guided QA bug-report writer: repro steps, expected vs. actual, severity triage, live quality checks, copy-ready Markdown export (single-file web app, Node-tested) |
| [16](day-16-known-errors) | Known Error Database | ITIL-style known-error database for support desks: searchable records with symptoms, workarounds, fix status, copy-to-ticket, JSON import/export (single-file web app, Node-tested) |
| [17](day-17-file-organizer) | File Organizer | CLI that tidies messy folders into category folders by file type: dry-run preview, clash-safe renames, undo log, date nesting, custom category maps (Node.js stdlib only) |
| [18](day-18-email-header-analyzer) | MailTrail: Email Header Analyzer | Paste raw email headers and get SPF/DKIM/DMARC results, the Received hop path with delays, phishing red flags, and a copy-ready summary (single-file web app, Node-tested) |
| [19](day-19-har-analyzer) | LoadLine: HAR File Analyzer | Drop a browser HAR file and get a support dashboard: waterfall, failed/slow flags, caching/compression/mixed-content insights, ticket-ready summary (single-file web app, Node-tested) |
| [20](day-20-cron-explainer) | CronLens: Cron Explainer & Next-Run Calculator | Paste a cron expression and get plain-English meaning, next run times, field breakdown, and gotcha warnings (single-file web app, Node-tested) |
