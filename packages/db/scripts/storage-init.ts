/** Creates the bucket if missing. Idempotent; works against any S3-compatible store. */
import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { storageConfigFromEnv } from '../src/storage'

const cfg = storageConfigFromEnv()
const s3 = new S3Client({
  endpoint: cfg.endpoint,
  region: cfg.region,
  forcePathStyle: true,
  credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
})
try {
  await s3.send(new HeadBucketCommand({ Bucket: cfg.bucket }))
  console.log(`Bucket ${cfg.bucket} exists`)
} catch {
  await s3.send(new CreateBucketCommand({ Bucket: cfg.bucket }))
  console.log(`Created bucket ${cfg.bucket}`)
}
