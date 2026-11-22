# Network Simulator: notes for contributors and AI assistants

- Product: web-based network simulation and learning platform (own engine, no real
  Cisco images). Roadmap in README.md; phases 1 (foundation), 2 (engine and
  topology editor) and 3 (CLI, OSPF/BGP, hosts and servers, IPsec) are done.
- Workspaces: `engine/` (simulation, pure TypeScript, built to dist and used by
  the server; the web app imports its source via a Vite alias), `server/`, `web/`.
  The engine is the single source of truth for the topology model
  (`engine/src/model.ts`) and its validation (`engine/src/schema.ts`). Device
  behaviour that phase 3 adds (CLI, more device models) builds on that model;
  routing protocols plug in through `registerRoutingProtocol`, filters (firewall)
  through `registerPacketFilter`, CLI modes through `registerCliExtension`. IPsec
  (`engine/src/protocols/ipsec.ts`) encapsulates in the simulator's output path.
- Branches: `production` (stable) and `test` (preview). Open pull requests into
  `test`; `test` is merged into `production` for a release. Servers update from
  these branches (see docs/updates.md), so never push broken code to them.
- House style: RHIS, in `brand/` (copied from `rhisijmuiden/rhis-huisstijl`). Use the
  Tailwind colour names from `web/src/styles.css` (nacht, koraal, lucht, surface,
  raised, ink, muted, line, ok, warn, bad). Coral buttons have nacht text. Headings
  use the `display` class (Archivo 125% wide, weight 800). Admin menus on the left.
- Languages: English is the default, Dutch must be complete. Every UI string goes
  through i18next; `npm run check-i18n` fails when en.json and nl.json differ.
  Server errors are codes (for example `backup.wrongPassphrase`) translated under
  `errors.*` in the web app.
- Deployment: native Debian 13 LXC, no Docker. The web server runs as `netsim`
  without privileges; root work (updates, restores) only happens in the helpers in
  `deploy/`, triggered by request files that carry validated data only.
- Database: forward-only migrations in `server/src/migrations.ts`; never edit a
  released migration.
- Checks before a pull request: `npm run typecheck`, `npm test`, `npm run check-i18n`,
  `npm run build`.
