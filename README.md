# Self-Healing Docs

Built for The Zerops Challenge (WeMakeDevs × Zerops)

## What it does

Self-Healing Docs answers reader questions from your real documentation, and quietly detects when the docs themselves are the problem. When the same question keeps getting a weak answer, it drafts a fix and opens a real GitHub pull request or issue for a human to review.

Worker code - https://github.com/chaitralikakde/self-healing-docs-worker

## The agents

- **Sentinel** (detector): watches every question, spots repeated questions the docs answer poorly, flags a gap.
- **Scribe** (writer): drafts a fix in the style of the existing docs, and rates its own confidence.
- **Warden** (reviewer): routes the draft, confident fixes become a pull request, less confident ones become an issue for human review.

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

## Stack (on Zerops)

- Frontend: static reader (`/ask`) and maintainer dashboard
- API: handles `/ask`, backed by Postgres + pgvector
- Worker: runs Sentinel → Scribe → Warden in sequence
- Postgres (pgvector): docs, questions, clusters, gaps, drafts
- Valkey: caching + activity feed

## What it uses

- **Embeddings** to turn docs and questions into vectors for similarity search
- **pgvector** (on Postgres) for storing and searching those vectors
- **An LLM** to answer reader questions (RAG) and to draft doc fixes
- **Confidence scoring** to decide when a gap is real and when a draft is trustworthy
- **GitHub API** to open real pull requests and issues
- **Valkey** for caching repeated questions and powering the live activity feed
- **Zerops** for hosting, private networking, and deployment

Only Frontend and API are public; Worker, Postgres, and Valkey stay on Zerops' private network.
