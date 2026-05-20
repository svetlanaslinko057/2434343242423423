# Synthetic Observation Matrix

**Ran:** `2026-05-17T21:32:07.288923+00:00`  
**Backend:** `http://localhost:8001`  
**Corpus size:** 100  

## Summary

- success: **72/100** (72%)
- latency p50/p95/p99/max: **44ms / 225ms / 1212ms / 1212ms**
- cache hit ratio on replay: **100%** (10/10)
- drift from expected (corpus prediction wrong): **13**

### Narrative quality (error messages)
- `good`: 28
- `ok`: 0
- `bad`: 0
- `n/a`: 72

### Estimate-seed quality (text usable for estimator)
- `useful`: 72
- `weak`: 0
- `n/a`: 28

### Error-kind distribution
- `SITE_BLOCKS_BOTS`: 15
- `INVALID_URL`: 7
- `SITE_UNREACHABLE`: 3
- `NOT_HTML`: 3

### By category

| category | n | success | error | success_rate |
|----------|---|---------|-------|--------------|
| 1_clean_saas | 20 | 20 | 0 | 100% |
| 2_marketing | 20 | 15 | 5 | 75% |
| 3_js_heavy | 15 | 13 | 2 | 86% |
| 4_bot_protected | 15 | 8 | 7 | 53% |
| 5_garbage | 12 | 1 | 11 | 8% |
| 6_verbose | 10 | 9 | 1 | 90% |
| 7_intl | 8 | 6 | 2 | 75% |

## Detail (sorted by category)

| # | URL | cat | http | error_kind | latency_ms | cached | chars | narrative | est-seed | match |
|---|-----|-----|------|------------|-----------:|--------|------:|-----------|----------|-------|
| 6 | `https://airtable.com` | 1_clean_saas | 200 | — | 44 | True | 1392 | n/a | useful | ✅ match |
| 2 | `https://linear.app` | 1_clean_saas | 200 | — | 46 | True | 1232 | n/a | useful | ✅ match |
| 4 | `https://slack.com` | 1_clean_saas | 200 | — | 45 | True | 1202 | n/a | useful | ✅ match |
| 1 | `https://stripe.com` | 1_clean_saas | 200 | — | 45 | True | 1239 | n/a | useful | ✅ match |
| 17 | `https://supabase.com` | 1_clean_saas | 200 | — | 44 | True | 1300 | n/a | useful | ✅ match |
| 7 | `https://www.atlassian.com` | 1_clean_saas | 200 | — | 44 | True | 1268 | n/a | useful | ✅ match |
| 13 | `https://www.cloudflare.com` | 1_clean_saas | 200 | — | 44 | True | 1335 | n/a | useful | ✅ match |
| 19 | `https://www.datadoghq.com` | 1_clean_saas | 200 | — | 44 | True | 1271 | n/a | useful | ✅ match |
| 14 | `https://www.digitalocean.com` | 1_clean_saas | 200 | — | 45 | True | 1313 | n/a | useful | ✅ match |
| 8 | `https://www.dropbox.com` | 1_clean_saas | 200 | — | 44 | True | 1360 | n/a | useful | ✅ match |
| 15 | `https://www.heroku.com` | 1_clean_saas | 200 | — | 44 | True | 1222 | n/a | useful | ✅ match |
| 9 | `https://www.hubspot.com` | 1_clean_saas | 200 | — | 45 | True | 1418 | n/a | useful | ✅ match |
| 5 | `https://www.intercom.com` | 1_clean_saas | 200 | — | 44 | True | 1498 | n/a | useful | ✅ match |
| 16 | `https://www.mongodb.com` | 1_clean_saas | 200 | — | 44 | True | 1186 | n/a | useful | ✅ match |
| 3 | `https://www.notion.so` | 1_clean_saas | 200 | — | 46 | True | 1046 | n/a | useful | ✅ match |
| 20 | `https://www.pipedrive.com` | 1_clean_saas | 200 | — | 44 | True | 1322 | n/a | useful | ✅ match |
| 18 | `https://www.postman.com` | 1_clean_saas | 200 | — | 44 | True | 1151 | n/a | useful | ✅ match |
| 10 | `https://www.salesforce.com` | 1_clean_saas | 200 | — | 46 | True | 1264 | n/a | useful | ✅ match |
| 12 | `https://www.twilio.com` | 1_clean_saas | 200 | — | 44 | True | 1267 | n/a | useful | ✅ match |
| 11 | `https://www.zendesk.com` | 1_clean_saas | 200 | — | 44 | True | 1240 | n/a | useful | ✅ match |
| 34 | `https://robinhood.com` | 2_marketing | 200 | — | 46 | True | 1250 | n/a | useful | ✅ match |
| 27 | `https://www.adidas.com` | 2_marketing | 200 | — | 44 | True | 1182 | n/a | useful | ✅ match |
| 22 | `https://www.airbnb.com` | 2_marketing | 200 | — | 44 | True | 1133 | n/a | useful | ✅ match |
| 40 | `https://www.allbirds.com` | 2_marketing | 200 | — | 45 | True | 1165 | n/a | useful | ✅ match |
| 21 | `https://www.apple.com` | 2_marketing | 200 | — | 44 | True | 1276 | n/a | useful | ✅ match |
| 23 | `https://www.coinbase.com` | 2_marketing | 422 | SITE_BLOCKS_BOTS | 146 | — | 0 | good | n/a | ⚠️ drift |
| 32 | `https://www.doordash.com` | 2_marketing | 422 | SITE_BLOCKS_BOTS | 130 | — | 0 | good | n/a | ⚠️ drift |
| 37 | `https://www.dyson.com` | 2_marketing | 200 | — | 46 | True | 1269 | n/a | useful | ✅ match |
| 38 | `https://www.glossier.com` | 2_marketing | 200 | — | 44 | True | 1047 | n/a | useful | ✅ match |
| 36 | `https://www.gopro.com` | 2_marketing | 200 | — | 44 | True | 1314 | n/a | useful | ✅ match |
| 33 | `https://www.lyft.com` | 2_marketing | 200 | — | 44 | True | 1170 | n/a | useful | ✅ match |
| 30 | `https://www.netflix.com` | 2_marketing | 200 | — | 4 | True | 1155 | n/a | useful | ✅ match |
| 26 | `https://www.nike.com` | 2_marketing | 200 | — | 44 | True | 1158 | n/a | useful | ✅ match |
| 35 | `https://www.peloton.com` | 2_marketing | 200 | — | 45 | True | 1242 | n/a | useful | ✅ match |
| 24 | `https://www.shopify.com` | 2_marketing | 200 | — | 44 | True | 1184 | n/a | useful | ✅ match |
| 29 | `https://www.spotify.com` | 2_marketing | 200 | — | 44 | True | 1125 | n/a | useful | ✅ match |
| 28 | `https://www.starbucks.com` | 2_marketing | 200 | — | 46 | True | 1249 | n/a | useful | ✅ match |
| 25 | `https://www.tesla.com` | 2_marketing | 422 | SITE_BLOCKS_BOTS | 176 | — | 0 | good | n/a | ⚠️ drift |
| 31 | `https://www.uber.com` | 2_marketing | 422 | SITE_UNREACHABLE | 215 | — | 0 | good | n/a | ⚠️ drift |
| 39 | `https://www.warbyparker.com` | 2_marketing | 422 | SITE_BLOCKS_BOTS | 217 | — | 0 | good | n/a | ⚠️ drift |
| 41 | `https://vercel.com` | 3_js_heavy | 200 | — | 45 | True | 1421 | n/a | useful | ✅ match |
| 55 | `https://www.anthropic.com` | 3_js_heavy | 200 | — | 44 | True | 1340 | n/a | useful | ✅ match |
| 44 | `https://www.canva.com` | 3_js_heavy | 422 | SITE_BLOCKS_BOTS | 284 | — | 0 | good | n/a | ✅ match |
| 51 | `https://www.codesandbox.io` | 3_js_heavy | 200 | — | 46 | True | 1189 | n/a | useful | ✅ match |
| 53 | `https://www.deepl.com` | 3_js_heavy | 200 | — | 44 | True | 1331 | n/a | useful | ✅ match |
| 52 | `https://www.duolingo.com` | 3_js_heavy | 200 | — | 45 | True | 1229 | n/a | useful | ✅ match |
| 42 | `https://www.figma.com` | 3_js_heavy | 200 | — | 44 | True | 1114 | n/a | useful | ✅ match |
| 43 | `https://www.framer.com` | 3_js_heavy | 200 | — | 44 | True | 1018 | n/a | useful | ✅ match |
| 47 | `https://www.loom.com` | 3_js_heavy | 200 | — | 44 | True | 1170 | n/a | useful | ✅ match |
| 45 | `https://www.miro.com` | 3_js_heavy | 200 | — | 44 | True | 1241 | n/a | useful | ✅ match |
| 48 | `https://www.netlify.com` | 3_js_heavy | 200 | — | 44 | True | 1314 | n/a | useful | ✅ match |
| 54 | `https://www.openai.com` | 3_js_heavy | 422 | SITE_BLOCKS_BOTS | 231 | — | 0 | good | n/a | ✅ match |
| 50 | `https://www.replit.com` | 3_js_heavy | 200 | — | 44 | True | 1229 | n/a | useful | ✅ match |
| 49 | `https://www.sentry.io` | 3_js_heavy | 200 | — | 44 | True | 1089 | n/a | useful | ✅ match |
| 46 | `https://www.webflow.com` | 3_js_heavy | 200 | — | 44 | True | 1446 | n/a | useful | ✅ match |
| 58 | `https://medium.com` | 4_bot_protected | 422 | SITE_BLOCKS_BOTS | 136 | — | 0 | good | n/a | ✅ match |
| 60 | `https://twitter.com` | 4_bot_protected | 200 | — | 44 | True | 1162 | n/a | useful | ⚠️ drift |
| 59 | `https://www.facebook.com` | 4_bot_protected | 200 | — | 44 | True | 1076 | n/a | useful | ⚠️ drift |
| 67 | `https://www.glassdoor.com` | 4_bot_protected | 422 | SITE_BLOCKS_BOTS | 181 | — | 0 | good | n/a | ✅ match |
| 68 | `https://www.indeed.com` | 4_bot_protected | 422 | SITE_BLOCKS_BOTS | 154 | — | 0 | good | n/a | ✅ match |
| 57 | `https://www.instagram.com` | 4_bot_protected | 200 | — | 44 | True | 1389 | n/a | useful | ⚠️ drift |
| 56 | `https://www.linkedin.com` | 4_bot_protected | 200 | — | 44 | True | 1247 | n/a | useful | ⚠️ drift |
| 63 | `https://www.pinterest.com` | 4_bot_protected | 200 | — | 45 | True | 1086 | n/a | useful | ⚠️ drift |
| 66 | `https://www.quora.com` | 4_bot_protected | 422 | SITE_BLOCKS_BOTS | 149 | — | 0 | good | n/a | ✅ match |
| 62 | `https://www.reddit.com` | 4_bot_protected | 422 | SITE_BLOCKS_BOTS | 161 | — | 0 | good | n/a | ✅ match |
| 65 | `https://www.snapchat.com` | 4_bot_protected | 200 | — | 44 | True | 1190 | n/a | useful | ⚠️ drift |
| 64 | `https://www.tiktok.com` | 4_bot_protected | 200 | — | 44 | True | 1193 | n/a | useful | ⚠️ drift |
| 70 | `https://www.yelp.com` | 4_bot_protected | 422 | SITE_BLOCKS_BOTS | 165 | — | 0 | good | n/a | ✅ match |
| 69 | `https://www.zillow.com` | 4_bot_protected | 422 | SITE_BLOCKS_BOTS | 225 | — | 0 | good | n/a | ✅ match |
| 61 | `https://x.com` | 4_bot_protected | 200 | — | 44 | True | 729 | n/a | useful | ⚠️ drift |
| 79 | `` | 5_garbage | 400 | INVALID_URL | 45 | — | 0 | good | n/a | ✅ match |
| 72 | `ftp://example.com` | 5_garbage | 400 | INVALID_URL | 43 | — | 0 | good | n/a | ✅ match |
| 73 | `http://localhost:8080` | 5_garbage | 400 | INVALID_URL | 44 | — | 0 | good | n/a | ✅ match |
| 81 | `https://` | 5_garbage | 400 | INVALID_URL | 43 | — | 0 | good | n/a | ✅ match |
| 82 | `https://192.168.1.1` | 5_garbage | 400 | INVALID_URL | 43 | — | 0 | good | n/a | ✅ match |
| 78 | `https://example.com` | 5_garbage | 200 | — | 44 | True | 622 | n/a | useful | ✅ match |
| 74 | `https://nonexistent-domain-xyz123abc.test` | 5_garbage | 422 | SITE_UNREACHABLE | 120 | — | 0 | good | n/a | ✅ match |
| 77 | `https://raw.githubusercontent.com/git/git/maste...` | 5_garbage | 400 | NOT_HTML | 43 | — | 0 | good | n/a | ✅ match |
| 76 | `https://upload.wikimedia.org/wikipedia/commons/...` | 5_garbage | 400 | NOT_HTML | 43 | — | 0 | good | n/a | ✅ match |
| 75 | `https://www.africau.edu/images/default/sample.pdf` | 5_garbage | 400 | NOT_HTML | 44 | — | 0 | good | n/a | ✅ match |
| 80 | `javascript:alert(1)` | 5_garbage | 400 | INVALID_URL | 44 | — | 0 | good | n/a | ✅ match |
| 71 | `not-a-url` | 5_garbage | 400 | INVALID_URL | 43 | — | 0 | good | n/a | ✅ match |
| 86 | `https://aws.amazon.com` | 6_verbose | 200 | — | 45 | True | 1308 | n/a | useful | ✅ match |
| 89 | `https://developer.mozilla.org` | 6_verbose | 200 | — | 45 | True | 1165 | n/a | useful | ✅ match |
| 88 | `https://docs.github.com` | 6_verbose | 200 | — | 44 | True | 1262 | n/a | useful | ✅ match |
| 84 | `https://docs.python.org/3/` | 6_verbose | 200 | — | 44 | True | 1169 | n/a | useful | ✅ match |
| 83 | `https://en.wikipedia.org/wiki/Stripe_(company)` | 6_verbose | 422 | SITE_BLOCKS_BOTS | 199 | — | 0 | good | n/a | ✅ match |
| 87 | `https://kubernetes.io` | 6_verbose | 200 | — | 45 | True | 1128 | n/a | useful | ✅ match |
| 90 | `https://nodejs.org/en` | 6_verbose | 200 | — | 44 | True | 1107 | n/a | useful | ✅ match |
| 91 | `https://reactjs.org` | 6_verbose | 200 | — | 44 | True | 1182 | n/a | useful | ✅ match |
| 85 | `https://www.mit.edu` | 6_verbose | 200 | — | 44 | True | 1215 | n/a | useful | ✅ match |
| 92 | `https://www.stanford.edu` | 6_verbose | 200 | — | 44 | True | 1241 | n/a | useful | ✅ match |
| 99 | `https://ozon.ru` | 7_intl | 422 | SITE_BLOCKS_BOTS | 1109 | — | 0 | good | n/a | ✅ match |
| 100 | `https://wildberries.ru` | 7_intl | 422 | SITE_UNREACHABLE | 1212 | — | 0 | good | n/a | ✅ match |
| 93 | `https://www.baidu.com` | 7_intl | 200 | — | 45 | True | 1215 | n/a | useful | ✅ match |
| 97 | `https://www.lemonde.fr` | 7_intl | 200 | — | 44 | True | 1291 | n/a | useful | ✅ match |
| 98 | `https://www.mercadolibre.com.ar` | 7_intl | 200 | — | 44 | True | 1172 | n/a | useful | ✅ match |
| 95 | `https://www.rakuten.co.jp` | 7_intl | 200 | — | 44 | True | 1122 | n/a | useful | ✅ match |
| 96 | `https://www.spiegel.de` | 7_intl | 200 | — | 45 | True | 1292 | n/a | useful | ✅ match |
| 94 | `https://yandex.ru` | 7_intl | 200 | — | 44 | True | 1161 | n/a | useful | ✅ match |

## Cache replay results

| # | URL | http | latency_ms | cached |
|---|-----|------|-----------:|--------|
| 1 | `https://stripe.com` | 200 | 45 | True |
| 2 | `https://linear.app` | 200 | 45 | True |
| 3 | `https://www.notion.so` | 200 | 44 | True |
| 4 | `https://www.airbnb.com` | 200 | 44 | True |
| 5 | `https://www.apple.com` | 200 | 45 | True |
| 6 | `https://www.dropbox.com` | 200 | 46 | True |
| 7 | `https://www.hubspot.com` | 200 | 44 | True |
| 8 | `https://vercel.com` | 200 | 44 | True |
| 9 | `https://docs.python.org/3/` | 200 | 45 | True |
| 10 | `https://kubernetes.io` | 200 | 44 | True |

## Drift (result ≠ expected)

| URL | expected | got_kind | http | notes |
|-----|----------|----------|------|-------|
| `https://www.coinbase.com` | success | SITE_BLOCKS_BOTS | 422 | This site blocks automated reading. |
| `https://www.tesla.com` | success | SITE_BLOCKS_BOTS | 422 | This site blocks automated reading. |
| `https://www.uber.com` | success | SITE_UNREACHABLE | 422 | We couldn't reach that site. |
| `https://www.doordash.com` | success | SITE_BLOCKS_BOTS | 422 | This site blocks automated reading. |
| `https://www.warbyparker.com` | success | SITE_BLOCKS_BOTS | 422 | This site blocks automated reading. |
| `https://www.linkedin.com` | SITE_BLOCKS_BOTS | OK | 200 |  |
| `https://www.instagram.com` | SITE_BLOCKS_BOTS | OK | 200 |  |
| `https://www.facebook.com` | SITE_BLOCKS_BOTS | OK | 200 |  |
| `https://twitter.com` | SITE_BLOCKS_BOTS | OK | 200 |  |
| `https://x.com` | SITE_BLOCKS_BOTS | OK | 200 |  |
| `https://www.pinterest.com` | SITE_BLOCKS_BOTS | OK | 200 |  |
| `https://www.tiktok.com` | SITE_BLOCKS_BOTS | OK | 200 |  |
| `https://www.snapchat.com` | SITE_BLOCKS_BOTS | OK | 200 |  |

