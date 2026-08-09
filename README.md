# Self-Healing Docs

Built for The Zerops Challenge (WeMakeDevs × Zerops)

Note - It takes 2-3 mins to make a PR to the github, thanks for your patience


## What it is

Most documentation tools help *readers* find answers. Self-Healing Docs does something different: it watches how people actually use your docs, figures out where the docs themselves are letting readers down, and fixes it, automatically drafting the correction and opening a real GitHub pull request or issue for a human to review.

Think of it less like a chatbot and more like an immune system for your documentation. It doesn't just answer questions, it notices when the *same* question keeps coming up with a bad answer, treats that as a symptom of a problem in the docs, and responds by healing the docs themselves.

## The problem

Documentation goes stale the moment nobody's watching it. A page gets written once, and from then on it just quietly drifts out of date. Readers hit the gap, ask the same confused question in five slightly different ways, get a mediocre answer each time, and give up. Nobody connects the dots, because nobody's counting how often that pattern happens or realizing it means the docs, not the reader, need fixing.

## How it works

Three AI agents run in the background, one after another, every time someone asks a question:

1. **Sentinel** (the detector). Reads the incoming question, checks how well the existing docs actually answer it, and compares it to other questions that have been asked before. If the same underlying question keeps getting asked *and* the docs keep answering it poorly, that's flagged as a **documentation gap**.

2. **Scribe** (the writer). Once a gap is confirmed, Scribe drafts an actual fix: a new doc section or an edit to an existing one, written in the same style and tone as the rest of the docs. It also rates its own confidence, how much of the draft is based on solid, verifiable information versus its own best guess.

3. **Warden** (the reviewer). Looks at Scribe's draft and its confidence score, and decides how to route it. If the draft is solid, it opens a real **GitHub pull request**, ready to merge. If it's shakier, it opens a **GitHub issue** instead, tagged for review, so a human checks it before anything goes live. Nothing gets published without a person's say so unless it's already high confidence.

Every step of this reasoning, the question that triggered it, the confidence scores, the routing decision, is visible on a maintainer dashboard, so nothing happens as a black box.

## What people actually see

- **Readers** get a simple ask box. Type a question, get an answer pulled straight from the real docs, in a few seconds. That's the whole experience from their side.
- **Maintainers** get a dashboard showing which parts of the docs are struggling in real time, ranked by how often the gap has been hit, with the drafted fix, the reasoning for how it was routed, and a direct link to the live GitHub PR or issue it opened.

## Architecture

```
                      ┌─────────────┐
Reader ──question──▶  │  Frontend   │
                      │ (ask +      │
Maintainer ──views──▶ │  dashboard) │
                      └──────┬──────┘
                             │ HTTPS
                             ▼
                      ┌─────────────┐        ┌──────────────┐
                      │     API     │◀──────▶│    Valkey    │
                      │             │  cache │   (cache)    │
                      └──────┬──────┘        └──────────────┘
                             │ enqueue job
                             ▼
                      ┌─────────────┐
                      │   Worker    │
                      │             │
                      │  Sentinel   │──▶ score + cluster
                      │     │       │
                      │     ▼       │
                      │   Scribe    │──▶ drafts fix (only if gap)
                      │     │       │
                      │     ▼       │
                      │   Warden    │──▶ routes: PR or issue
                      └──────┬──────┘
                             │
                ┌────────────┴────────────┐
                ▼                          ▼
         ┌─────────────┐          ┌────────────────┐
         │  Postgres   │          │   GitHub API    │
         │ (+pgvector) │          │ (opens PR/issue)│
         └─────────────┘          └────────────────┘
```

Only Frontend and API are exposed publicly. Worker, Postgres, and Valkey talk to each other over Zerops' private network.

## Services (5 total, on Zerops)

- **Frontend** (static): the reader ask box and the maintainer dashboard
- **API** (1 server): handles the `/ask` endpoint, public-facing, backed by Postgres + pgvector
- **Worker** (1 background process): runs Sentinel → Scribe → Warden in sequence. Kept as a single worker on purpose, not three separate services, to avoid unnecessary deploy complexity
- **Postgres** (managed, pgvector enabled): all structured data and vector search
- **Valkey** (managed): caching + the live activity feed

## Database

Postgres, with the `pgvector` extension enabled, is the only database. Tables:

| Table | Purpose |
|---|---|
| `docs_chunks` | Ingested documentation, chunked and embedded once at setup |
| `questions` | Every question ever asked, with its embedding, confidence score, and answer |
| `question_clusters` | Groups of "same underlying question," with an ask count and average confidence |
| `gaps` | Detected documentation gaps, linked to a cluster |
| `drafts` | Scribe's drafted fixes, with a writer confidence score |
| `actions` | Warden's routing decisions, the real GitHub PR/issue URL and status |
| `faq_entries` | Public-facing FAQ, the byproduct readers see |

Valkey sits alongside Postgres as a cache, not a database, purely for speed and the real-time activity feed.

## What it uses

- **Embeddings** to turn docs and questions into vectors for similarity search
- **pgvector** (on Postgres) for storing and searching those vectors
- **An LLM** to answer reader questions (RAG) and to draft doc fixes
- **Confidence scoring** to decide when a gap is real and when a draft is trustworthy
- **GitHub API** to open real pull requests and issues
- **Valkey** for caching repeated questions and powering the live activity feed
- **Zerops** for hosting, private networking, and deployment

## Gap and routing logic

- A **gap** is flagged when a question cluster's `ask_count >= 3` and `avg_confidence < 0.5`.
- A **draft** with `writer_confidence >= 0.7` is routed as a pull request.
- A **draft** below that threshold is routed as an issue, tagged `docs-gap`, for human review.

These thresholds are tunable and meant to be checked against real questions on real docs, not left as guesses.
