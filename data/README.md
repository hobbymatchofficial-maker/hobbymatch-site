# Site data

## reviews.json: "What our users say" (/reviews)

**Only genuine reviews that real people posted publicly, copied exactly.**
Never write, invent, edit, shorten, "tidy up" or translate a review, and
never add one we paid for, swapped for a reward or asked only happy users
to leave. Include negative reviews as well as positive ones. The page
promises all of this in its reviews policy, and UK consumer law (the
DMCC Act 2024 bans fake and concealed incentivised reviews) and the app
stores' rules require it.

The file starts empty (`[]`). Each review is one object:

```json
[
  {
    "name": "Sam",
    "date": "2026-11-20",
    "rating": 4,
    "source": "App Store",
    "url": "https://apps.apple.com/gb/app/id6762534449?see-all=reviews",
    "title": "Optional: the review's own title, exactly as written",
    "text": "Optional: the review text, exactly as written"
  }
]
```

| Field | Required | Notes |
| --- | --- | --- |
| `name` | yes | The reviewer's first name or handle as shown on the source. No surnames. |
| `date` | yes | The date on the review, `YYYY-MM-DD`. |
| `rating` | yes | Whole stars, 1 to 5, as given on the source. |
| `source` | yes | `App Store`, `Google Play` or `Trustpilot`. |
| `url` | yes | A link where anyone can see the review: an `apps.apple.com`, `play.google.com` or `trustpilot.com` address. |
| `title`, `text` | no | Copied word for word. Leave out rather than shorten. |

Then rebuild the page and commit both files:

```bash
node scripts/build-reviews.mjs
```

The script refuses an entry with a missing field, a rating outside 1 to 5,
a future date or a link that isn't on one of the three sources. It shows
newest first, whatever the rating. The page has **no review or rating
structured data** (Google treats ratings a business shows about itself as
self-serving).
