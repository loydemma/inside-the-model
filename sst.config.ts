/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: 'inside-the-model',
      // Production resources are retained on `sst remove`; dev stages are torn down.
      removal: input?.stage === 'production' ? 'retain' : 'remove',
      home: 'aws',
      providers: { aws: { region: 'us-east-1' } },
    }
  },
  async run() {
    // Static site: S3 + CloudFront. No secrets or server code.
    new sst.aws.StaticSite('InsideTheModel', {
      build: { command: 'npm run build', output: 'dist' },
      // Keep the site out of search results: every response says noindex.
      edge: {
        viewerResponse: {
          injection: `event.response.headers['x-robots-tag'] = { value: 'noindex, nofollow' };`,
        },
      },
    })
  },
})
