import { randomInt } from 'node:crypto'
import { ulid } from 'ulid'

export const newId = (): string => ulid()

/**
 * Share slugs are capability URLs (§16): random, non-sequential, 8 chars from an
 * unambiguous alphabet (no 0/O, 1/I/L). 31^8 ≈ 8.5e11 possibilities.
 */
const SLUG_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
export function newShareSlug(length = 8): string {
  let s = ''
  for (let i = 0; i < length; i++) s += SLUG_ALPHABET[randomInt(SLUG_ALPHABET.length)]
  return s
}

/** 6-char group join code, same alphabet. */
export const newJoinCode = () => newShareSlug(6)
