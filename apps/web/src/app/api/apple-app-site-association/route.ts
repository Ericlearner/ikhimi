/**
 * Apple's app-site association (served at /.well-known/apple-app-site-association, next.config.ts): links to this site
 * open in the iOS app (apps/ios) when it's installed, like assetlinks.json does for Android. Needs APPLE_TEAM_ID;
 * the app id is APPLE_BUNDLE_ID (default kr.ikhimi.app).
 */
export function GET() {
  const team = process.env.APPLE_TEAM_ID?.trim()
  if (!team) return new Response('Not found', { status: 404 })
  const appId = `${team}.${process.env.APPLE_BUNDLE_ID?.trim() || 'kr.ikhimi.app'}`
  return Response.json(
    {
      applinks: {
        details: [
          {
            appIDs: [appId],
            // Everything but the API and file downloads
            components: [
              { '/': '/api/*', exclude: true },
              { '/': '/download/*', exclude: true },
              { '/': '/.well-known/*', exclude: true },
              { '/': '*' },
            ],
          },
        ],
      },
      webcredentials: { apps: [appId] },
    },
    { headers: { 'Cache-Control': 'public, max-age=3600' } },
  )
}
