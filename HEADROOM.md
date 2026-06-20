# Headroom - Context Compression for AI Agents

This project uses [Headroom](https://github.com/chopratejas/headroom) to compress AI context, reducing tokens by 60-95% while preserving accuracy.

## Overview

Headroom sits between opencode and the LLM provider, compressing:
- Tool outputs (grep, search results, file reads)
- Logs (build, test, lint)
- JSON responses (API, database)
- Conversation history

## Setup

### 1. Install Headroom

```bash
# Using pipx (recommended)
pipx install "headroom-ai[all]"

# Or using a virtual environment
python3 -m venv ~/.headroom-venv
~/.headroom-venv/bin/pip install "headroom-ai[all]"
```

### 2. Start the Proxy

In **Terminal 1**, run:

```bash
ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" headroom proxy --port 8787
```

The proxy runs locally at `http://127.0.0.1:8787`.

### 3. Run opencode

In **Terminal 2**, run:

```bash
cd /home/dlitorja/projects/mentorships-infra
ANTHROPIC_BASE_URL=http://127.0.0.1:8787/v1 opencode
```

All LLM requests will now be compressed automatically.

### 4. Verify It's Working

While opencode is running, check stats in **Terminal 1**:

```bash
curl http://127.0.0.1:8787/stats
```

Look for:
- `api_requests` increasing as you use opencode
- `total_tokens_saved_total` growing
- `savings_percent` showing actual compression (typically 40-90%)

## Monitoring

Check compression stats:

```bash
curl http://localhost:8787/stats
```

View detailed history:

```bash
curl http://localhost:8787/stats-history
```

Health check:

```bash
curl http://localhost:8787/health
```

## How It Works

```
opencode → headroom proxy → LLM provider
              ↓
         [compress]
              ↓
         60-95% fewer tokens
```

The proxy auto-detects content type and routes to the best compressor:

| Content Type | Compressor | Typical Savings |
|--------------|------------|-----------------|
| JSON arrays | SmartCrusher | 70-90% |
| Source code | CodeCompressor | 40-70% |
| Search results | SearchCompressor | 80-95% |
| Build/test logs | LogCompressor | 85-95% |
| Plain text | Kompress | 30-50% |

## Reversible (CCR)

Original content is cached locally. If the LLM needs full context, it can retrieve originals on demand within the TTL (1 hour local, 5 min via proxy).

## Troubleshooting

**"No connection" errors:**
- Verify the proxy is running: `curl http://localhost:8787/health`
- Check the proxy port matches `opencode.json` (default 8787)

**High latency:**
- First request has cold start overhead (~10-30s for ML models)
- Subsequent requests are faster (<100ms)

**High memory usage:**
- Reduce compression with `headroom proxy --no-llmlingua`
- Disable ML features: `pip install "headroom-ai[proxy]"` (no [ml] extra)

## Configuration

The proxy reads environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `HEADROOM_PORT` | 8787 | Proxy port |
| `HEADROOM_HOST` | 127.0.0.1 | Proxy host |
| `HEADROOM_UPDATE_CHECK` | on | Check for updates (once/day) |

For advanced configuration, see [Headroom docs](https://headroom-docs.vercel.app/docs/proxy).

## Cost Impact

With a fixed Zen subscription ($40-80/mo), compression effectively gives you **2-5x more context capacity** for the same cost. Real-world benchmarks:

| Workload | Before | After | Savings |
|----------|--------|-------|---------|
| Code search (100 results) | 17,765 tokens | 1,408 tokens | 92% |
| SRE incident | 65,694 tokens | 5,118 tokens | 92% |
| GitHub issue triage | 54,174 tokens | 14,761 tokens | 73% |
| Codebase exploration | 78,502 tokens | 41,254 tokens | 47% |