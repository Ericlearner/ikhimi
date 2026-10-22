import { describe, expect, it } from 'vitest'
import { extForMime, materialObjectKey, sanitizeFilename } from './storage'
import { uploadKindForMime } from './config'

describe('storage helpers', () => {
  it('never lets client paths into object keys', () => {
    expect(materialObjectKey('T1', 'M1', 'jpg')).toBe('materials/T1/M1.jpg')
    expect(materialObjectKey('T1', 'M1', '../../etc')).toBe('materials/T1/M1.bin')
  })
  it('sanitizes display filenames', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd')
    expect(sanitizeFilename('C:\\Users\\x\\Track 10.mp3')).toBe('Track 10.mp3')
    expect(sanitizeFilename('..hidden')).toBe('hidden')
    expect(sanitizeFilename('a\u0000b<c>.png')).toBe('abc.png')
    expect(sanitizeFilename('')).toBe('file')
  })
  it('maps mime types to upload kinds', () => {
    expect(uploadKindForMime('image/jpeg')).toBe('image')
    expect(uploadKindForMime('audio/mpeg')).toBe('audio')
    expect(uploadKindForMime('application/pdf')).toBe('pdf')
    expect(uploadKindForMime('application/x-msdownload')).toBeNull()
    expect(extForMime('audio/mpeg')).toBe('mp3')
  })
})
