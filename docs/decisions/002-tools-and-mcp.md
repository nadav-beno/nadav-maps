# 002: One tool layer for the app, the API and MCP

**Decision.** Every data operation is a `defineTool` with a Zod input schema in `packages/tools`. The
browser calls tools directly against public providers; `apps/server` exposes the same tools over REST
and over MCP (stateless Streamable HTTP). No AI agent yet, by request: MCP only.

**Why.** One definition means the AI-facing surface can never drift from what the app does, and moving the
web app to call our own server later is a config change.
