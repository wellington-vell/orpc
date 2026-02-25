import type { Client, ThrowableError } from '@orpc/client'

export type experimental_ToORPCClientResult<T extends Record<string, any>> = {
  [K in keyof T]:
  T[K] extends (options: infer UInput)
  => Promise<infer UResult>
    ? Client<Record<never, never>, UInput, {
      body: UResult extends { data: infer USuccess } ? Exclude<USuccess, undefined> : never
      request: Request
      response: Response
    }, ThrowableError>
    : T[K] extends Record<string, any>
      ? experimental_ToORPCClientResult<T[K]>
      : never
}

function parseFunctionName(name: string): { prefix: string, version: string, method: string } | null {
  const match = name.match(/^([a-z]+)(V\d+)([A-Z][a-z]*)$/)
  if (!match || !match[1] || !match[2] || !match[3])
    return null
  return {
    prefix: match[1],
    version: match[2].toLowerCase(),
    method: match[3].toLowerCase(),
  }
}

function clientWrapper(fn: (input?: Record<string, any>, options?: Record<string, any>) => Promise<any>) {
  return async (input?: Record<string, any>, options?: Record<string, any>) => {
    const controller = new AbortController()

    if (input?.signal?.aborted || options?.signal?.aborted) {
      controller.abort()
    }
    else {
      input?.signal?.addEventListener('abort', () => controller.abort())
      options?.signal?.addEventListener('abort', () => controller.abort())
    }

    const result = await fn({
      ...input,
      signal: controller.signal,
      headers: {
        ...input?.headers,
        ...typeof options?.lastEventId === 'string' ? { 'last-event-id': options.lastEventId } : {},
      },
      throwOnError: true,
    })

    return {
      body: result.data,
      request: result.request,
      response: result.response,
    }
  }
}

function isFlatSDK(sdk: Record<string, any>): boolean {
  const keys = Object.keys(sdk)
  if (keys.length === 0)
    return false
  const firstKey = keys[0]!
  const fn = sdk[firstKey]
  return typeof fn === 'function'
}

function autoNestSDK(sdk: Record<string, any>): Record<string, any> {
  const grouped: Record<string, any> = {}

  for (const key in sdk) {
    const fn = sdk[key]
    if (typeof fn !== 'function')
      continue

    const parsed = parseFunctionName(key)
    if (!parsed) {
      grouped[key] = clientWrapper(fn)
      continue
    }

    const { prefix, version, method } = parsed

    if (!grouped[prefix]) {
      grouped[prefix] = {}
    }
    if (!grouped[prefix][version]) {
      grouped[prefix][version] = {}
    }

    grouped[prefix][version][method] = clientWrapper(fn)
  }

  return grouped
}

/**
 * Convert a Hey API SDK to an oRPC client.
 *
 * @see {@link https://orpc.dev/docs/integrations/hey-api Hey API Docs}
 */
export function experimental_toORPCClient<T extends Record<string, any>>(sdk: T): experimental_ToORPCClientResult<T> {
  const client = isFlatSDK(sdk as Record<string, any>)
    ? autoNestSDK(sdk as Record<string, any>)
    : {} as Record<string, any>

  for (const key in sdk) {
    const fn = sdk[key]

    if (!fn || typeof fn !== 'function') {
      if (fn && typeof fn === 'object') {
        client[key] = experimental_toORPCClient(fn)
      }
      continue
    }

    if (!client[key]) {
      client[key] = clientWrapper(fn)
    }
  }

  return client as experimental_ToORPCClientResult<T>
}
