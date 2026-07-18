import startHandler from '@tanstack/react-start/server-entry'

import { routeRequest } from './edge-router'

export default {
  fetch(request, env) {
    return routeRequest(request, env.ORIGIN_BACKEND, startHandler.fetch)
  },
} satisfies ExportedHandler<CloudflareEnv>
