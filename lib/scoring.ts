export const MONTGOMERY_ZIPS = new Set([
  '45401','45402','45403','45404','45405','45406','45407','45408','45409','45410',
  '45411','45412','45413','45414','45415','45416','45417','45418','45419','45420',
  '45421','45422','45423','45424','45425','45426','45427','45428','45429','45430',
  '45431','45432','45433','45434','45435','45436','45437','45438','45439','45440',
  '45441','45449','45450','45458','45459','45469','45470','45475','45479','45481',
  '45482','45490'
])

export const YEAR_WEIGHT: Record<number, number> = {
  2021: 0.6, 2022: 0.8, 2023: 0.85, 2024: 1.0, 2025: 1.15, 2026: 1.3
}

export const OFFICE_PROXIMITY: Record<string, Record<string, number>> = {
  county: {
    'HOUSE': 1.5, 'COURT OF APPEALS JUDGE': 1.4, 'STATE BOARD OF EDUCATION': 1.3,
    'SENATE': 1.2, 'GOVERNOR': 1.1, 'SUPREME COURT JUSTICE': 1.0,
    'SUPREME COURT CHIEF JUSTICE': 1.0, 'ATTORNEY GENERAL': 1.0,
    'AUDITOR': 1.0, 'TREASURER': 1.0, 'SECRETARY OF STATE': 1.0,
  },
  house: {
    'HOUSE': 1.5, 'SENATE': 1.3, 'STATE BOARD OF EDUCATION': 1.2,
    'COURT OF APPEALS JUDGE': 1.1, 'GOVERNOR': 1.1, 'SUPREME COURT JUSTICE': 1.0,
    'SUPREME COURT CHIEF JUSTICE': 1.0, 'ATTORNEY GENERAL': 1.0,
    'AUDITOR': 1.0, 'TREASURER': 1.0, 'SECRETARY OF STATE': 1.0,
  },
  statewide: {
    'GOVERNOR': 1.5, 'ATTORNEY GENERAL': 1.3, 'SUPREME COURT JUSTICE': 1.3,
    'SUPREME COURT CHIEF JUSTICE': 1.3, 'AUDITOR': 1.2, 'TREASURER': 1.2,
    'SECRETARY OF STATE': 1.2, 'SENATE': 1.1, 'HOUSE': 1.0,
    'COURT OF APPEALS JUDGE': 1.0, 'STATE BOARD OF EDUCATION': 1.0,
  },
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

export type GeoFilter = 'montgomery' | 'statewide' | 'all'
export type OfficeTarget = 'county' | 'house' | 'statewide'

export function scoreAndGroup(
  rows: RawRow[],
  weights: ScoreWeights,
  geo: GeoFilter,
  officeTarget: OfficeTarget
): Donor[] {
  const filtered = rows.filter(r => {
    if ((r.PARTY || '').trim().toUpperCase() !== 'REPUBLICAN') return false
    if ((r.NON_INDIVIDUAL || '').trim()) return false
    if (!(r.LAST_NAME || '').trim()) return false
    const amt = parseFloat((r.AMOUNT || '0').replace(',', ''))
    if (isNaN(amt) || amt < 250) return false
    const zip5 = (r.ZIP || '').trim().substring(0, 5)
    const state = (r.STATE || '').trim().toUpperCase()
    if (geo === 'montgomery' && !MONTGOMERY_ZIPS.has(zip5)) return false
    if (geo === 'statewide' && state !== 'OH') return false
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

  const officeW = OFFICE_PROXIMITY[officeTarget] || OFFICE_PROXIMITY.county
  const results: (Donor & { _raw?: number })[] = []

  Object.entries(clusters).forEach(([key, rows]) => {
    const total = rows.reduce((s, r) => s + parseFloat((r.AMOUNT || '0').replace(',', '') || '0'), 0)
    const sizeScore = rows.reduce((s, r) => s + Math.log(Math.max(parseFloat((r.AMOUNT || '0').replace(',', '') || '0'), 250)), 0)
    const recScore = rows.reduce((s, r) => s + (YEAR_WEIGHT[parseInt(r.RPT_YEAR || '2022')] || 0.8), 0)
    const freqBonus = Math.log(rows.length + 1) * 10
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
    })

    results[results.length - 1]['_raw'] = raw as any
  })

  const scores = results.map(r => (r as any)['_raw'] as number)
  const minS = Math.min(...scores)
  const maxS = Math.max(...scores)

  results.forEach(r => {
    const raw = (r as any)['_raw'] as number
    delete (r as any)['_raw']
    r.donor_score = maxS === minS ? 50 : Math.round(1 + 99 * (raw - minS) / (maxS - minS))
    if (r.donor_score >= 40) r.tier = 'A'
    else if (r.donor_score >= 20) r.tier = 'B'
    else if (r.donor_score >= 10) r.tier = 'C'
    else if (r.donor_score >= 5) r.tier = 'D'
    else r.tier = 'E'
  })

  return results.sort((a, b) => b.donor_score - a.donor_score).map((r, i) => ({ ...r, rank: i + 1 } as any))
}
