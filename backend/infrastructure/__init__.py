"""
Infrastructure adapters — outward-facing boundaries.

Sub-packages:
  • db/repositories/  — typed wrappers around MongoDB collections (single
                        writer per collection invariant)
  • payments/         — Stripe / WayForPay / mock adapters
  • email/            — Resend adapter
  • storage/          — Cloudinary adapter
  • llm/              — LiteLLM / OpenAI adapter
  • realtime/         — Socket.IO server adapter

Rules:
  • infrastructure/* may import from shared/*
  • infrastructure/* must NOT import from domains/* or app/*
"""
