import { ZIP_TO_COUNTY } from './counties'

export const YEAR_WEIGHT: Record<number, number> = {
  2021: 0.6, 2022: 0.8, 2023: 0.85, 2024: 1.0, 2025: 1.15, 2026: 1.3
}

export const OFFICE_LIST = [
  'HOUSE',
  'SENATE',
  'GOVERNOR',
  'SUPREME COURT JUSTICE',
  'SUPREME COURT CHIEF JUSTICE',
  'COURT OF APPEALS JUDGE',
  'ATTORNEY GENERAL',
  'AUDITOR',
  'TREASURER',
  'SECRETARY OF STATE',
  'STATE BOARD OF EDUCATION',
]

// Build proximity weights: selected office = 1.5, adjacent = 1.2, rest = 1.0
export function buildOfficeWeights(targetOffice: string): Record<string, number> {
  const weights: Record<string, number> = {}
  OFFICE_LIST.forEach(o => { weights[o] = 1.0 })
  weights[targetOffice] = 1.5
  // Boost adjacent offices
  const adjacency: Record<string, string[]> = {
    'HOUSE': ['SENATE', 'STATE BOARD OF EDUCATION'],
    'SENATE': ['HOUSE', 'GOVERNOR'],
    'GOVERNOR': ['SENATE', 'ATTORNEY GENERAL'],
    'SUPREME COURT JUSTICE': ['SUPREME COURT CHIEF JUSTICE', 'COURT OF APPEALS JUDGE'],
    'SUPREME COURT CHIEF JUSTICE': ['SUPREME COURT JUSTICE', 'COURT OF APPEALS JUDGE'],
    'COURT OF APPEALS JUDGE': ['SUPREME COURT JUSTICE', 'HOUSE'],
    'ATTORNEY GENERAL': ['GOVERNOR', 'AUDITOR'],
    'AUDITOR': ['ATTORNEY GENERAL', 'TREASURER'],
    'TREASURER': ['AUDITOR', 'SECRETARY OF STATE'],
    'SECRETARY OF STATE': ['TREASURER', 'GOVERNOR'],
    'STATE BOARD OF EDUCATION': ['HOUSE', 'SENATE'],
  }
  ;(adjacency[targetOffice] || []).forEach(o => {
    if (weights[o] < 1.5) weights[o] = 1.2
  })
  return weights
}

export type GeoMode = 'county' | 'statewide' | 'all'

export interface GeoFilter {
  mode: GeoMode
  county?: string  // Ohio county name when mode === 'county'
}

export interface RawRow {
  COM_NAME?: string
  FIRST_NAME?: string
  MIDDLE_NAME?: string
  LAST_NAME?: string
  SUFFIX_NAME?: string
  NON_INDIVIDUAL?: string
  ADDRESS?: string
  CITY?: string
  STATE?: string
  ZIP?: string
  AMOUNT?: string
  RPT_YEAR?: string
  FILE_DATE?: string
  EVENT_DATE?: string
  OFFICE?: string
  DISTRICT?: string
  PARTY?: string
  CANDIDATE_FIRST_NAME?: string
  CANDIDATE_LAST_NAME?: string
  EMP_OCCUPATION?: string
  REPORT_DESCRIPTION?: string
}

export interface Donation {
  first_name: string
  last_name: string
  address: string
  city: string
  state: string
  zip: string
  amount: number
  rpt_year: number
  file_date: string
  office: string
  party: string
  candidate_first: string
  candidate_last: string
  emp_occupation: string
  com_name: string
  report_description: string
}

export interface Donor {
  id: string
  first_name: string
  last_name: string
  address: string
  city: string
  zip: string
  total_donated: number
  num_donations: number
  offices: string
  candidates_donated_to: string
  donor_score: number
  tier: string
  donations: Donation[]
}

export interface ScoreWeights {
  size: number
  recency: number
  freq: number
  office: number
}

function passesGeo(zip5: string, state: string, geo: GeoFilter): boolean {
  if (geo.mode === 'all') return true
  if (state !== 'OH') return false
  if (geo.mode === 'statewide') return true
  if (geo.mode === 'county' && geo.county) {
    return ZIP_TO_COUNTY[zip5] === geo.county
  }
  return false
}

export function scoreAndGroup(
  rows: RawRow[],
  weights: ScoreWeights,
  geo: GeoFilter,
  officeTarget: string
): Donor[] {
  const officeW = buildOfficeWeights(officeTarget)

  const filtered = rows.filter(r => {
    // Filter self-donations (candidate funding own campaign)
    const donorLast = (r.LAST_NAME || '').trim().toUpperCase()
    const candLast = (r.CANDIDATE_LAST_NAME || '').trim().toUpperCase()
    if (donorLast && candLast && donorLast === candLast) return false
    if ((r.PARTY || '').trim().toUpperCase() !== 'REPUBLICAN') return false
    if ((r.NON_INDIVIDUAL || '').trim()) return false
    if (!(r.LAST_NAME || '').trim()) return false
    const amt = parseFloat((r.AMOUNT || '0').replace(',', ''))
    if (isNaN(amt) || amt < 250) return false
    const zip5 = (r.ZIP || '').trim().substring(0, 5)
    const state = (r.STATE || '').trim().toUpperCase()
    if (!passesGeo(zip5, state, geo)) return false
    return true
  })

  const clusters: Record<string, RawRow[]> = {}
  filtered.forEach(r => {
    const key = [
      (r.LAST_NAME || '').trim().toUpperCase(),
      (r.FIRST_NAME || '').trim().toUpperCase(),
      (r.ZIP || '').trim().substring(0, 5),
    ].join('_')
    if (!clusters[key]) clusters[key] = []
    clusters[key].push(r)
  })

  const results: (Donor & { _raw?: number })[] = []

  Object.entries(clusters).forEach(([key, rows]) => {
    const total = rows.reduce((s, r) => s + parseFloat((r.AMOUNT || '0').replace(',', '') || '0'), 0)
    const totalDonated = rows.reduce((s, r) => s + Math.max(parseFloat((r.AMOUNT || '0').replace(',', '') || '0'), 0), 0)
    const avgGift = totalDonated / rows.length
    // Size score: avg gift is the primary quality signal (steep power curve)
    // Total donated is a secondary commitment signal (moderate log curve)
    // This prevents high-volume low-dollar donors from gaming the score
    const avgGiftScore = Math.log(1 + Math.pow(Math.max(avgGift, 250) / 250, 2.5))
    const totalScore = Math.log(1 + totalDonated / 500)
    const sizeScore = avgGiftScore * 0.65 + totalScore * 0.25
    const recScore = rows.reduce((s, r) => s + (YEAR_WEIGHT[parseInt(r.RPT_YEAR || '2022')] || 0.8), 0)
    const freqBonus = Math.log(Math.min(rows.length, 8) + 1) * 10  // capped at 8 to prevent volume gaming
    const offScore = rows.reduce((s, r) => s + (officeW[(r.OFFICE || '').trim()] || 1.0), 0)
    const raw = sizeScore * weights.size + recScore * weights.recency + freqBonus * weights.freq + offScore * weights.office

    const nameCounts: Record<string, number> = {}
    rows.forEach(r => {
      const n = `${(r.FIRST_NAME || '').trim()} ${(r.LAST_NAME || '').trim()}`.trim()
      nameCounts[n] = (nameCounts[n] || 0) + 1
    })
    const bestName = Object.entries(nameCounts).sort((a, b) => b[1] - a[1])[0][0]
    const parts = bestName.split(' ')
    const first = parts[0] || ''
    const last = parts.slice(1).join(' ') || ''
    const sorted = [...rows].sort((a, b) => parseInt(b.RPT_YEAR || '0') - parseInt(a.RPT_YEAR || '0'))
    const candidates = [...new Set(rows.map(r =>
      `${(r.CANDIDATE_FIRST_NAME || '').trim()} ${(r.CANDIDATE_LAST_NAME || '').trim()}`.trim()
    ).filter(Boolean))]
    const offices = [...new Set(rows.map(r => (r.OFFICE || '').trim()).filter(Boolean))]

    const donations: Donation[] = rows.map(r => ({
      first_name: (r.FIRST_NAME || '').trim(),
      last_name: (r.LAST_NAME || '').trim(),
      address: (r.ADDRESS || '').trim(),
      city: (r.CITY || '').trim(),
      state: (r.STATE || '').trim(),
      zip: (r.ZIP || '').trim().substring(0, 5),
      amount: parseFloat((r.AMOUNT || '0').replace(',', '') || '0'),
      rpt_year: parseInt(r.RPT_YEAR || '0'),
      file_date: (r.FILE_DATE || '').trim(),
      office: (r.OFFICE || '').trim(),
      party: (r.PARTY || '').trim(),
      candidate_first: (r.CANDIDATE_FIRST_NAME || '').trim(),
      candidate_last: (r.CANDIDATE_LAST_NAME || '').trim(),
      emp_occupation: (r.EMP_OCCUPATION || '').trim(),
      com_name: (r.COM_NAME || '').trim(),
      report_description: (r.REPORT_DESCRIPTION || '').trim(),
    })).sort((a, b) => b.rpt_year - a.rpt_year || b.amount - a.amount)

    results.push({
      id: key,
      first_name: first,
      last_name: last,
      address: (sorted[0].ADDRESS || '').trim(),
      city: (sorted[0].CITY || '').trim(),
      zip: (sorted[0].ZIP || '').trim().substring(0, 5),
      total_donated: Math.round(total),
      num_donations: rows.length,
      candidates_donated_to: candidates.join('; '),
      offices: offices.join('; '),
      donor_score: 0,
      tier: '',
      donations,
      _raw: raw,
    })
  })

  const scores = results.map(r => r._raw as number)
  const minS = Math.min(...scores)
  const maxS = Math.max(...scores)

  results.forEach(r => {
    const raw = r._raw as number
    delete r._raw
    r.donor_score = maxS === minS ? 50 : Math.round(1 + 99 * (raw - minS) / (maxS - minS))
    if (r.donor_score >= 40) r.tier = 'A'
    else if (r.donor_score >= 20) r.tier = 'B'
    else if (r.donor_score >= 10) r.tier = 'C'
    else if (r.donor_score >= 5) r.tier = 'D'
    else r.tier = 'E'
  })

  return results.sort((a, b) => b.donor_score - a.donor_score).map((r, i) => ({ ...r, rank: i + 1 } as any))
}
