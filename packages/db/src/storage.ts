/**
 * S3-compatible object storage (SeaweedFS or any S3-compatible store, or self-hosted, §6).
 * Browsers upload directly with presigned POSTs; every read is a short-lived signed URL.
 */
import { GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { createPresignedPost } from '@aws-sdk/s3-presigned-post'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export type StorageConfig = {
  endpoint: string
  publicEndpoint?: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
}

export function storageConfigFromEnv(e = process.env): StorageConfig {
  const need = (k: string) => {
    const v = e[k]
    if (!v) throw new Error(`${k} is not set`)
    return v
  }
  return {
    endpoint: need('S3_ENDPOINT'),
    publicEndpoint: e.S3_PUBLIC_ENDPOINT || undefined,
    region: e.S3_REGION ?? 'us-east-1',
    bucket: e.S3_BUCKET ?? 'ikhimi',
    accessKeyId: need('S3_ACCESS_KEY'),
    secretAccessKey: need('S3_SECRET_KEY'),
  }
}

const makeClient = (cfg: StorageConfig, endpoint: string) =>
  new S3Client({
    endpoint,
    region: cfg.region,
    forcePathStyle: true, // self-hosted S3 (SeaweedFS etc.)
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  })

export function createStorage(cfg: StorageConfig = storageConfigFromEnv()) {
  const internal = makeClient(cfg, cfg.endpoint)
  // Presigned URLs embed the host, so sign them against the endpoint the browser can reach.
  const pub = cfg.publicEndpoint ? makeClient(cfg, cfg.publicEndpoint) : internal

  return {
    bucket: cfg.bucket,

    /** Browser-direct upload, with size and content-type enforced by the storage server itself. */
    presignUpload(key: string, contentType: string, maxBytes: number, expiresSeconds = 600) {
      return createPresignedPost(pub, {
        Bucket: cfg.bucket,
        Key: key,
        Conditions: [
          ['content-length-range', 1, maxBytes],
          ['eq', '$Content-Type', contentType],
        ],
        Fields: { 'Content-Type': contentType },
        Expires: expiresSeconds,
      })
    },

    async head(key: string) {
      const r = await internal.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }))
      return { bytes: r.ContentLength ?? 0, contentType: r.ContentType ?? null }
    },

    async getStream(key: string) {
      const r = await internal.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }))
      if (!r.Body) throw new Error(`Empty object: ${key}`)
      return r.Body as unknown as AsyncIterable<Uint8Array>
    },

    signedReadUrl(key: string, expiresSeconds = 300) {
      return getSignedUrl(pub, new GetObjectCommand({ Bucket: cfg.bucket, Key: key }), { expiresIn: expiresSeconds })
    },
  }
}

export type Storage = ReturnType<typeof createStorage>

const g = globalThis as unknown as { __ikhimiStorage?: Storage }
export function getStorage(): Storage {
  g.__ikhimiStorage ??= createStorage()
  return g.__ikhimiStorage
}

/** Object key for an uploaded material. Never derived from client-supplied paths (§16). */
export function materialObjectKey(teacherId: string, materialId: string, ext: string) {
  const safeExt = /^[a-z0-9]{1,5}$/.test(ext) ? ext : 'bin'
  return `materials/${teacherId}/${materialId}.${safeExt}`
}

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif',
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac',
  'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'audio/webm': 'webm',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',
}
export const extForMime = (mime: string) => EXT_BY_MIME[mime] ?? 'bin'

/** Display-safe version of a client filename: no paths, no control chars, bounded length. */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? ''
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').replace(/^\.+/, '').trim()
  return (cleaned || 'file').slice(0, 180)
}
