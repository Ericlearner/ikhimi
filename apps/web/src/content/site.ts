/**
 * Facts the legal and help pages quote. Change a value here and every page follows.
 * Placeholders in [BRACKETS] must be filled before launch (Korean e-commerce law requires the business details on
 * the site: 상호, 대표자, 사업자등록번호, 통신판매업 신고번호, 주소, 연락처).
 */
import { CONFIG } from '@ikhimi/db'

export const SITE = {
  /** Legal operator. No company yet. */
  operatorName: '[상호]',
  operatorCeo: '[대표자]',
  operatorTaxId: '[사업자등록번호]',
  mailOrderNumber: '[통신판매업 신고번호]',
  operatorAddress: '[사업장 주소]',
  /** 개인정보 보호책임자 (PIPA art. 31) */
  privacyOfficer: '[개인정보 보호책임자 성명·연락처]',
  supportEmail: '[support@ikhimi.kr]',
  refundPolicy: '[환불 규정: 아직 정하지 않음]',
  /** Versioned so a material change can ask users to accept again */
  legalVersion: '0.1',
  legalUpdated: '2026-10-22',
  retentionMonths: CONFIG.studentDataRetentionMonths,
  guardianUnderAge: CONFIG.guardianRequiredUnderAge,
  /** Where data physically lives today (update when the hosting regions are chosen) */
  hosting: { app: 'Vercel [리전]', db: 'Neon [리전]', ai: 'Google Gemini' },
} as const

/** Support is by email (the help chat's "write to the team" opens the same address) */
export const supportMailto = () => `mailto:${SITE.supportEmail}`
