# Self-Healing Docs

Built for The Zerops Challenge (WeMakeDevs × Zerops)

## What it does

Self-Healing Docs answers reader questions from your real documentation, and quietly detects when the docs themselves are the problem. When the same question keeps getting a weak answer, it drafts a fix and opens a real GitHub pull request or issue for a human to review.

## The agents

- **Sentinel** (detector): watches every question, spots repeated questions the docs answer poorly, flags a gap.
- **Scribe** (writer): drafts a fix in the style of the existing docs, and rates its own confidence.
- **Warden** (reviewer): routes the draft, confident fixes become a pull request, less confident ones become an issue for human review.

## Stack (on Zerops)

- Frontend: static reader (`/ask`) and maintainer dashboard
- API: handles `/ask`, backed by Postgres + pgvector
- Worker: runs Sentinel → Scribe → Warden in sequence
- Postgres (pgvector): docs, questions, clusters, gaps, drafts
- Valkey: caching + activity feed

Only Frontend and API are public; Worker, Postgres, and Valkey stay on Zerops' private network.
