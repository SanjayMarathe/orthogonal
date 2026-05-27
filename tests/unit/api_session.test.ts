import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inferUseArgsFromDetails,
  matchFollowUpToEndpoint,
  parseEndpointsFromAssistant,
  scoreEndpointMatch,
} from "../../supabase/functions/_shared/apiSession.ts";

const CAPABILITY_CARD = `## Scrape Creators (\`@scrapecreators\`)

**5 endpoints** available via Orthogonal:

- **GET \`/v1/kick/clip\`** — Kick
- **GET \`/v1/tiktok/creators/popular\`** — Get popular creators
- **GET \`/v1/threads/post\`** — Post
- **GET \`/v1/reddit/subreddit\`** — Subreddit Posts
- **GET \`/v1/youtube/playlist\`** — Playlist
`;

test("parseEndpointsFromAssistant extracts endpoints from capability card", () => {
  const eps = parseEndpointsFromAssistant(CAPABILITY_CARD);
  assert.equal(eps.length, 5);
  assert.equal(eps[1].path, "/v1/tiktok/creators/popular");
  assert.match(eps[1].description, /popular creators/i);
});

test("matchFollowUpToEndpoint picks tiktok popular for creator question", () => {
  const eps = parseEndpointsFromAssistant(CAPABILITY_CARD);
  const match = matchFollowUpToEndpoint("what are the popular creators?", eps);
  assert.ok(match);
  assert.equal(match!.path, "/v1/tiktok/creators/popular");
});

test("scoreEndpointMatch ranks popular creators endpoint highest", () => {
  const eps = parseEndpointsFromAssistant(CAPABILITY_CARD);
  const scores = eps.map((ep) => ({
    path: ep.path,
    score: scoreEndpointMatch("what are the popular creators?", ep),
  }));
  const best = scores.sort((a, b) => b.score - a.score)[0];
  assert.equal(best.path, "/v1/tiktok/creators/popular");
});

test("inferUseArgsFromDetails allows optional GET params", () => {
  const details = JSON.stringify({
    success: true,
    api: { slug: "scrapecreators" },
    endpoint: {
      path: "/v1/tiktok/creators/popular",
      method: "GET",
      queryParams: [
        { name: "page", required: false, type: "number" },
      ],
      bodyParams: [],
    },
  });
  const args = inferUseArgsFromDetails(
    details,
    "what are the popular creators?",
  );
  assert.ok(args);
  assert.equal(args!.api, "scrapecreators");
  assert.equal(args!.path, "/v1/tiktok/creators/popular");
});
