# Synthetic Behavioral Simulation — URL Corpus

**Цель:** проверить topology / UX stability / latency / narratives / cache economics на curated input.
**НЕ цель:** реальные продуктовые инсайты, statistical validation, fake growth.

40 URL, 6 категорий. Каждый кейс — explicit expectation. Прогон через `/api/estimate/analyze-url`.

## Категория 1 — Clean SaaS (extraction / summary / cache / speed)
| URL                          | expected_kind | note                                       |
|------------------------------|---------------|--------------------------------------------|
| https://stripe.com           | success       | payments, dense product info               |
| https://linear.app           | success       | project mgmt, clean SPA                    |
| https://www.notion.so        | success       | docs/workspace, marketing-heavy            |
| https://slack.com            | success       | enterprise comms                           |
| https://www.intercom.com     | success       | customer support                           |
| https://airtable.com         | success       | low-code DB                                |
| https://www.atlassian.com    | success       | enterprise suite, big nav                  |

## Категория 2 — Marketing-heavy (noisy HTML / hallucination resistance)
| URL                          | expected_kind | note                                       |
|------------------------------|---------------|--------------------------------------------|
| https://www.apple.com        | success       | minimal text, image-heavy                  |
| https://www.airbnb.com       | success       | hero copy heavy                            |
| https://www.coinbase.com     | success       | crypto, regulatory disclaimers             |
| https://www.shopify.com      | success       | ecommerce platform                         |
| https://www.tesla.com        | success       | minimal copy, brand-heavy                  |

## Категория 3 — JS-heavy / hydration-heavy (fetch robustness)
| URL                          | expected_kind | note                                       |
|------------------------------|---------------|--------------------------------------------|
| https://vercel.com           | success_or_empty | SSR/SPA mix                              |
| https://www.figma.com        | success_or_empty | hydration heavy                          |
| https://www.framer.com       | success_or_empty | animation-heavy SPA                      |
| https://www.canva.com        | success_or_empty | client-rendered                          |

## Категория 4 — Bot-protected / hostile (graceful failures)
| URL                              | expected_kind            | note                                |
|----------------------------------|--------------------------|-------------------------------------|
| https://www.linkedin.com         | SITE_BLOCKS_BOTS         | aggressive UA-block                 |
| https://www.instagram.com        | SITE_BLOCKS_BOTS         | login wall                          |
| https://medium.com               | success_or_blocks        | sometimes lets bots, sometimes not  |
| https://www.facebook.com         | SITE_BLOCKS_BOTS         | login wall                          |
| https://twitter.com              | SITE_BLOCKS_BOTS         | redirects, login wall               |

## Категория 5 — Non-product garbage (INVALID_URL / NOT_HTML / EMPTY_ANALYSIS)
| URL                                                                       | expected_kind     | note                            |
|---------------------------------------------------------------------------|-------------------|---------------------------------|
| not-a-url                                                                 | INVALID_URL       | malformed                       |
| ftp://example.com                                                         | INVALID_URL       | wrong scheme                    |
| http://localhost:8080                                                     | INVALID_URL       | localhost block                 |
| https://nonexistent-domain-xyz123.test                                   | SITE_UNREACHABLE  | DNS fail                        |
| https://example.com/file.pdf                                              | NOT_HTML          | PDF                             |
| https://upload.wikimedia.org/wikipedia/commons/4/47/PNG_transparency_demonstration_1.png | NOT_HTML | image MIME                      |
| https://raw.githubusercontent.com/git/git/master/README.md                | NOT_HTML_or_EMPTY | plain text                      |
| https://example.com                                                       | success_or_empty  | IANA placeholder, minimal text  |
|                                                                           | INVALID_URL       | empty string                    |

## Категория 6 — Verbose / huge / token-pressure (truncation behavior)
| URL                                  | expected_kind | note                                 |
|--------------------------------------|---------------|--------------------------------------|
| https://en.wikipedia.org/wiki/Stripe_(company) | success | huge text body                  |
| https://docs.python.org/3/            | success_or_truncated | massive docs landing          |
| https://www.mit.edu                   | success       | university homepage                  |
| https://aws.amazon.com                | success       | enterprise, many sections            |
| https://kubernetes.io                 | success       | docs heavy                           |
| https://docs.github.com               | success       | docs                                 |

## Cache replay set (для измерения hit ratio)
Прогоняется 2× первый набор (Stripe, Linear, Notion, Airbnb, Apple).
Ожидание: 2-й прогон — `cached:true`, latency < 100ms, без LLM-billing.

## Admin reuse simulation
После прогона корпуса — `/api/estimate/analyze-url/telemetry` ×4:
- `copy_click` (surface=admin)
- `insert_into_reply_click` (surface=admin)
- 2× `cache_hit` reuse через повтор анализа

## Что НЕ делаем
- Не запускаем 1000 random URLs (это noise).
- Не симулируем real users (нет fake account creation).
- Не делаем happy-path-only.
- Не игнорируем ugly-path (там structural weakness живёт).
