# Self-Healing Documentation

**Built for:** The Zerops Challenge (WeMakeDevs × Zerops)
**One-liner:** Most AI docs tools help readers find answers. This tells maintainers what's broken in their docs — and fixes it.

FOr demo purpose please ask the same question twice so that count is 2 and then the AI Agent will start writing the draft for that check the maintainer's dashboard
---

## 1. The idea

Docs go stale the moment nobody's watching them. Readers ask the same unanswered question in different words, get a mediocre or honest "not covered" answer each time, and nobody notices the pattern. This system watches every question asked against the docs, detects when the **docs themselves** — not the reader — are the problem, drafts the fix, and routes it to a human: a GitHub pull request if it's confident, an issue if it's not.

It's not a chatbot. It's an immune system for documentation.

---

## 2. Try it

### As a reader
1. Open the [live app](https://frontend-2db1.prg1.zerops.app) → **Docs** tab to browse the demo documentation (a fictional CLI tool, "Wayfarer").
2. Switch to **Ask** → type a question in plain English. You get an answer grounded in the actual docs in a few seconds, with a confidence score and cited sources.

### As a maintainer
1. Ask the **same underlying question twice**, worded differently but keeping the same key phrase (e.g. "how do I set environment variables" / "where do I configure env vars") — this is the core trigger: a *pattern* of the same unanswered question, not a single miss.
2. Switch to the **Maintainer** tab. Within ~1 second you'll see the gap appear as `pending`. Within ~10 seconds (real LLM drafting + GitHub API call) it updates live to `routed`, with:
   - The real questions that triggered it
   - The Writer agent's drafted doc fix
   - The Reviewer agent's routing decision + reasoning
   - A link to the **real GitHub PR or issue** that was just opened

Nothing needs to be manually refreshed — the dashboard polls and updates live.

### Hitting the API directly
```bash
# Ask a question
curl -X POST https://apistage-2db1-3000.prg1.zerops.app/ask \
  -H 'Content-Type: application/json' \
  -d '{"question":"how do I install the CLI"}'

# List detected gaps
curl https://apistage-2db1-3000.prg1.zerops.app/gaps

# Full detail on one gap (questions, draft, routing decision)
curl https://apistage-2db1-3000.prg1.zerops.app/gaps/1

# Live activity feed
curl https://apistage-2db1-3000.prg1.zerops.app/activity

# Browse the ingested docs
curl https://apistage-2db1-3000.prg1.zerops.app/docs
```

---

## 3. Architecture

```
                          ┌─────────────┐
   Reader ───question───▶ │  Frontend   │
                          │ (Ask + Docs │
   Maintainer ───views──▶ │ + Dashboard)│
                          └──────┬──────┘
                                 │ HTTPS
                                 ▼
                          ┌─────────────┐        ┌──────────────┐
                          │   API       │◀──────▶│  Valkey      │
                          │ (Node +     │  queue │  (job queue) │
                          │  Express)   │        └──────────────┘
                          └──────┬──────┘
                                 │ LPUSH question id
                                 ▼
                          ┌─────────────┐
                          │   Worker    │
                          │ (3 agents,  │
                          │  sequential)│
                          │             │
                          │ Detector    │──▶ cluster + gap score
                          │    │        │
                          │    ▼        │
                          │ Writer      │──▶ drafts fix (only if gap)
                          │    │        │
                          │    ▼        │
                          │ Reviewer    │──▶ routes: real PR or issue
                          └──────┬──────┘
                                 │
                    ┌────────────┴────────────┐
                    ▼                          ▼
             ┌─────────────┐          ┌────────────────┐
             │  Postgres   │          │  GitHub API     │
             │ (+pgvector) │          │ (opens PR/issue)│
             └─────────────┘          └────────────────┘
```

**5 Zerops services:** Frontend (static), API (dev+stage runtime pair), Worker (runtime), Postgres, Valkey — all on Zerops' private network. Only Frontend and API are public.

### Request flow, step by step

1. **Reader asks** → `POST /ask` on the API.
2. **API**: embeds the question (Gemini), vector-searches `docs_chunks` in Postgres (pgvector cosine distance), asks Gemini a direct "does this excerpt actually answer the question — yes/no" judgment, returns the answer + confidence to the reader immediately, and pushes the question's id onto a Valkey list (`question-queue`). The reader never waits on anything below this.
3. **Worker** (`BRPOP` loop on that same queue) runs the three agents in sequence, only as far as needed:
   - **Detector** — matches the question against existing `question_clusters` by embedding similarity (same underlying question asked differently → same cluster), increments `ask_count`, updates a running average of the yes/no coverage judgments. If a cluster has enough asks and most were "not covered," it inserts a `gaps` row.
   - **Writer** (only on a new gap) — pulls the real questions in that cluster and the nearest existing (insufficient) doc content, drafts a doc patch matching the docs' style, and self-scores how grounded the draft is in real existing content vs. invented.
   - **Reviewer** — above a confidence threshold, opens a real GitHub **PR** (new branch, file commit, PR against the repo's default branch); below it, opens a real GitHub **issue** tagged `docs-gap` with the draft attached. If PR creation fails for any reason (e.g. empty repo, no commits yet), it automatically falls back to an issue rather than failing the pipeline.
4. **Maintainer dashboard** polls `GET /gaps`, `/gaps/:id`, `/activity` and shows the whole thing live.

### Resilience by design
Every external call (embeddings, generation, GitHub) degrades gracefully instead of crashing the pipeline:
- No `GEMINI_API_KEY` → deterministic mock embeddings + template drafts, same code path.
- Gemini quota/outage → falls back to a mock answer/draft, logged, request still succeeds.
- GitHub PR creation fails → automatically retries as an issue instead of erroring out.

---

## 4. Data model (Postgres, `pgvector` enabled)

| Table | Purpose |
|---|---|
| `docs_chunks` | Ingested docs, chunked (~500 words) and embedded once at setup |
| `questions` | Every question ever asked, its embedding, the LLM's coverage judgment, and the answer given |
| `question_clusters` | Clusters of "same underlying question," with running `ask_count` / `avg_confidence` |
| `gaps` | Detected documentation gaps (`pending` → `drafted` → `routed`) |
| `drafts` | The Writer agent's proposed doc patches + self-scored confidence |
| `actions` | The Reviewer's routing decisions — the real GitHub PR/issue URLs |
| `faq_entries` | Public FAQ promotion target (schema present, not yet wired to a promotion flow) |

---

## 5. Tech stack

| Layer | Choice |
|---|---|
| Frontend | Vanilla HTML/CSS/JS, no build step — static hosting on Zerops (nginx) |
| API | Node.js 22, Express |
| Worker | Node.js 22, plain long-running process (no framework) |
| Database | Managed PostgreSQL 18 on Zerops, `pgvector` extension |
| Queue / cache | Managed Valkey 7.2 on Zerops — `LPUSH`/`BRPOP` as a lightweight job queue between API and Worker |
| Embeddings | Google Gemini (`gemini-embedding-001`, 768-dim) |
| Generation | Google Gemini (`gemini-flash-latest`) — both the reader-facing answers and the Writer's drafts |
| GitHub integration | `@octokit/rest` — real branch/commit/PR and issue creation |
| Postgres client | `pg` |
| Redis/Valkey client | `ioredis` |
| Platform | [Zerops](https://zerops.io) — 5 services, private network, managed Postgres + Valkey |
| Built with | [Claude Code](https://claude.com/claude-code) (Anthropic) via Zerops' ZCP coding-agent integration |

---

## 6. How Zerops is used, specifically

| Need | Zerops feature |
|---|---|
| Run the API and Worker | Two runtime services (Node.js), independently scalable — API as a dev+stage pair, Worker as a single always-on service |
| Structured data + vector search | Managed **Postgres** with `pgvector` enabled |
| Job queue between API and Worker | Managed **Valkey** |
| API ↔ Worker ↔ Postgres ↔ Valkey | Zerops **private network** — internal hostnames, no public exposure except Frontend/API |
| Static frontend hosting | Zerops **static service**, nginx-served |
| Build & deploy | `zerops.yaml` per service, written by Claude Code through ZCP as the project was built conversationally |
| Verifying it actually works | ZCP's deploy-and-verify loop — reads logs, retries, confirms each service live before moving on |

---

## 7. Project structure

```
apidev/            # API service (dev + stage pair → apistage)
  server.js         # /ask, /docs, /gaps, /gaps/:id, /activity, /faq
  lib/db.js          # Postgres pool
  lib/llm.js          # Gemini answer generation + coverage judgment
  lib/queue.js         # enqueue onto Valkey
  scripts/embed.js      # Gemini embeddings (mock fallback, dependency-free)
  scripts/ingest.js      # chunk + embed + insert docs/*.md → docs_chunks
  scripts/migrate.js      # schema + pgvector extension
  docs/*.md                # demo documentation corpus

worker/             # Background pipeline service
  index.js            # BRPOP loop
  detector.js           # clustering + gap scoring
  writer.js               # drafts fixes
  reviewer.js               # routes PR/issue
  lib/llm.js                  # Gemini drafting
  lib/github.js                 # real GitHub PR/issue creation (mock fallback)

frontend/           # Static reader + maintainer app
  index.html / style.css / app.js   # Docs tab, Ask tab, Maintainer dashboard
```

---

## 8. Known limitations

- **Demo docs are fictional** ("Wayfarer CLI") rather than a real product's docs — chosen so the same corpus could be reused for reliable testing.
- **Narrow-corpus confidence**: with only ~7 short docs on one product, raw embedding similarity alone runs high even for uncovered sub-topics — confidence is a direct Gemini yes/no judgment per question instead, which resolved this.
- **FAQ promotion** (turning a resolved gap into a public FAQ entry) has a schema but no automated trigger yet.
- **Cluster similarity threshold** (0.8) favors precision over recall — a genuinely broader rephrasing of a question may be treated as a separate topic rather than merged.
