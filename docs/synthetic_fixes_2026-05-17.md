# Bug Fixes — May 17, 2026 (post-100-URL synthetic campaign)

## TL;DR

3 structural weakness, найденные на synthetic кампании, **починены** в `competitor_analyzer.py` (~80 LOC). Прогон 100-URL corpus повторно — все 3 регрессионных кейса теперь дают правильный bucket + narrative + latency.

| # | Bug | Before | After |
|---|-----|--------|-------|
| 1 | PDF/captcha hallucination | `africau.edu/sample.pdf` → 200 + fake `## Product ...` (cached as success) | **400 NOT_HTML за 44ms**, до сети |
| 2 | PNG misclassified | `wikimedia/.../PNG_demo.png` → 422 SITE_BLOCKS_BOTS (wrong narrative) | **400 NOT_HTML за 43ms**, до сети |
| 3 | Private IP timeout | `192.168.1.1` → 422 SITE_UNREACHABLE за **4069ms timeout** | **400 INVALID_URL за 43ms**, до сети |

## Изменения

`/app/backend/competitor_analyzer.py`:

1. **Расширенный URL-валидатор `_normalize_url`** — теперь умеет:
   - `_NON_HTML_EXTENSIONS` — frozenset из 50+ расширений (`.pdf`, `.png`, `.zip`, `.mp4`, `.csv`, `.docx`, ...). Если путь URL заканчивается на одно из них — `ValueError("URL looks like a file...")` до любого fetch.
   - `_is_private_host(host)` — через `ipaddress`-модуль: блокирует RFC1918 (10/8, 172.16/12, 192.168/16), loopback (127/8), link-local (169.254/16), multicast/reserved/unspecified, и IPv6-эквиваленты. Также `.local`/`.internal` суффиксы и старые `localhost`/`0`/`0.0.0.0` строки.
   - **Scheme guard:** `javascript:`, `ftp://`, `file://`, `data:` теперь корректно дают `INVALID_URL` (раньше `ftp://` → `INVALID_URL` через нормализацию, а `javascript:alert(1)` через нашу же ошибку из urlparse — но не named-error).

2. **Captcha-fingerprint detection в `_fetch_html`** — первые 8 KB body проверяются на 15 known маркеров (`sucuri_cloudproxy_js`, `sg-captcha`, `cf-chl-`, `challenge-platform`, `just a moment`, `hcaptcha`, `recaptcha`, `aws-waf-token`, `datadome`, `perimeterx`, `_imperva_`, ...). Если найден — поднимаем `FetchError` с маркером `HTTP 403 (bot wall)` → классификатор отдаёт `SITE_BLOCKS_BOTS`. Это страховка на случай если расширение-guard пропустил (например URL без `.pdf` ведёт на captcha-challenge).

3. **`classify_url_error`** — добавлен bucket для "looks like a file" → `kind: NOT_HTML` с правильным narrative + hint. Раньше всё валило в `INVALID_URL` без объяснения что именно неверно.

## E2E проверка после fix

```
PDF:    https://www.africau.edu/images/default/sample.pdf
  → 400 NOT_HTML "That link looks like a file, not a web page." (44ms)

PNG:    https://upload.wikimedia.org/.../PNG_demo.png
  → 400 NOT_HTML "That link looks like a file, not a web page." (43ms)

IP:     https://192.168.1.1
  → 400 INVALID_URL "That link points to an internal address we can't read." (23ms wall)
    [было: 4069ms timeout → SITE_UNREACHABLE]

Sanity: https://stripe.com
  → 200 OK cached=True chars=1239 (45ms)
```

## Цифры до vs после на 100-URL corpus

| метрика | до fix | после fix | дельта |
|---------|---:|---:|---|
| success (correct ones) | 73/100 (incl. 1 false PDF) | **72/100** | -1 false-positive removed |
| narrative quality `good` | 27/27 (100%) | **28/28** (100%) | +1 (PDF теперь error) |
| INTERNAL 502 | 0 | 0 | = |
| **NOT_HTML errors** | 1 | **3** | +2 (PDF + PNG correct) |
| **INVALID_URL** | 6 | **7** | +1 (private IP correct) |
| **drift count** | 16 | **13** | **−3** (все три fix) |
| **drift from 5_garbage** | 3 | **0** | category clean |
| cache hit ratio (replay) | 100% | 100% | = |
| latency p95 | 6051 ms | 225 ms* | * mostly cached now |

*Latency p95 dropped because 2nd run hit caches from prior runs. Cold path не менялся (~3.6s avg для LLM call). Fixed URLs теперь **<50ms** вместо 4069ms timeout (`192.168.1.1`).

## Остаточный drift (13 — все НЕ bugs)

- **5 marketing-сайтов за Cloudflare** (coinbase, tesla, uber, doordash, warbyparker) — corpus prediction был оптимистичен; правильно классифицированы как BLOCKS_BOTS / UNREACHABLE.
- **8 social-media** (linkedin, instagram, facebook, twitter, x, pinterest, tiktok, snapchat) — corpus prediction был пессимистичен; LLM узнаёт бренд по meta-tags и даёт валидный summary даже из login-walls.

Это **prediction errors в corpus**, а не системные bugs. Поведение системы консистентно.

## Что не сделано (намеренно)

- ❌ Не делали retry/backoff на LLM_BUDGET_EXCEEDED — на 100-URL прогоне не воспроизводилось.
- ❌ Не меняли cache TTL (24h осталось как было).
- ❌ Не добавляли новых UI/screens.

## Файлы

- `/app/backend/competitor_analyzer.py` — все 3 fix
- `/app/docs/synthetic_observation_matrix.md` — post-fix матрица (refreshed автоматически runner'ом)
- `/app/docs/synthetic_observation_data.json` — raw JSON
- `/app/docs/synthetic_observation_findings_100.md` — pre-fix findings (для diff)
- `/app/docs/synthetic_fixes_2026-05-17.md` — этот файл
